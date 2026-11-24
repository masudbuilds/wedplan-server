import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";
import { createRemoteJWKSet, jwtVerify } from "jose";

// ============================================================================
// 1. CONSTANTS & SYSTEM DEFINITIONS
// ============================================================================
const CATEGORIES = [
  "Photography",
  "Videography",
  "Catering",
  "Decoration",
  "Venue",
  "Bridal Makeup",
];

const USER_ROLES = {
  CUSTOMER: "customer",
  VENDOR: "vendor",
  ADMIN: "admin",
};

const SERVICE_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const BOOKING_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};

const TRANSACTION_STATUS = {
  COMPLETED: "completed",
  FAILED: "failed",
};

const FREE_PLAN_LIMIT = 3;

// ============================================================================
// 2. STRIPE CLIENT & DATABASE CONNECTION (SERVERLESS-SAFE CACHED POOL)
// ============================================================================
let stripeInstance = null;
function getStripe() {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured.");
    }
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}

let client = null;
let database = null;
let connectPromise = null;

export async function connectToMongoDB() {
  if (database) {
    return database;
  }
  if (connectPromise) {
    return connectPromise;
  }

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME || "wedplan";

  if (!uri) {
    throw new Error("MONGODB_URI is not defined in environment variables");
  }

  connectPromise = (async () => {
    try {
      client = new MongoClient(uri);
      await client.connect();
      database = client.db(dbName);
      console.log(`Connected to MongoDB database: ${dbName}`);
      await createIndexes(database);
      return database;
    } catch (err) {
      connectPromise = null;
      throw err;
    }
  })();

  return connectPromise;
}

async function createIndexes(db) {
  try {
    const services = db.collection("services");
    await services.createIndex({ status: 1 });
    await services.createIndex({ vendorId: 1 });
    await services.createIndex({ isActive: 1 });
    await services.createIndex({ category: 1 });

    const bookings = db.collection("bookings");
    await bookings.createIndex({ customerId: 1 });
    await bookings.createIndex({ vendorId: 1 });
    await bookings.createIndex({ serviceId: 1 });

    // Partial unique index stops race conditions for duplicate active bookings
    await bookings.createIndex(
      { serviceId: 1, customerId: 1, eventDate: 1 },
      {
        unique: true,
        partialFilterExpression: {
          status: { $in: ["pending", "accepted"] },
        },
      }
    );

    const transactions = db.collection("transactions");
    await transactions.createIndex({ stripeSessionId: 1 }, { unique: true, sparse: true });
    await transactions.createIndex({ stripeInvoiceId: 1 }, { unique: true, sparse: true });
    await transactions.createIndex({ vendorId: 1 });
  } catch (err) {
    console.warn("Index creation warning:", err.message);
  }
}

function getUsersCollection() {
  return database.collection("users");
}
function getServicesCollection() {
  return database.collection("services");
}
function getBookingsCollection() {
  return database.collection("bookings");
}
function getTransactionsCollection() {
  return database.collection("transactions");
}

// ============================================================================
// 3. EXPRESS APP INITIALIZATION
// ============================================================================
const app = express();
const port = process.env.PORT || 5000;

// ============================================================================
// 4. STRIPE WEBHOOK ROUTE (FIRST ROUTE - MUST BE BEFORE ANY BODY PARSER/MIDDLEWARE)
// ============================================================================
function getSubscriptionPeriodEnd(subscription) {
  const timestamp =
    subscription?.current_period_end ??
    subscription?.items?.data?.[0]?.current_period_end ??
    subscription?.items?.data?.[0]?.period?.end;

  if (timestamp) {
    return new Date(timestamp * 1000);
  }
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

async function findVendorForSubscription(vendorId, stripeSubId) {
  const usersCollection = getUsersCollection();
  if (vendorId) {
    const byId = await usersCollection.findOne({
      $or: [
        { _id: vendorId },
        { id: vendorId },
        ...(ObjectId.isValid(vendorId) ? [{ _id: new ObjectId(vendorId) }] : []),
      ],
    });
    if (byId && byId.role === USER_ROLES.VENDOR) {
      return byId;
    }
  }

  if (stripeSubId) {
    const bySub = await usersCollection.findOne({
      stripeSubscriptionId: stripeSubId,
      role: USER_ROLES.VENDOR,
    });
    if (bySub) {
      return bySub;
    }
  }
  return null;
}

async function handleCheckoutSessionCompleted(session) {
  const isPaid =
    session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (!isPaid) return;

  const vendorId = session.metadata?.vendorId || session.client_reference_id;
  const stripeSubId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

  const vendor = await findVendorForSubscription(vendorId, stripeSubId);
  if (!vendor) {
    console.log(`[webhook] vendor not found for id ${vendorId}`);
    return;
  }

  let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (stripeSubId) {
    try {
      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(stripeSubId);
      periodEnd = getSubscriptionPeriodEnd(subscription);
    } catch {
      // fallback to 30 days
    }
  }

  const usersCollection = getUsersCollection();
  await usersCollection.updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: periodEnd,
        stripeSubscriptionId: stripeSubId || vendor.stripeSubscriptionId || null,
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : vendor.stripeCustomerId || null,
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      },
    }
  );
  console.log(`[webhook] premium activated for vendor ${vendorId}`);

  const transactionsCollection = getTransactionsCollection();
  const existingTx = await transactionsCollection.findOne({ stripeSessionId: session.id });
  if (!existingTx) {
    await transactionsCollection.insertOne({
      vendorId: vendor._id.toString(),
      plan: "premium",
      amount: (session.amount_total || 0) / 100,
      currency: (session.currency || "usd").toUpperCase(),
      status: TRANSACTION_STATUS.COMPLETED,
      type: "subscription_create",
      stripeSessionId: session.id,
      stripeSubscriptionId: stripeSubId || null,
      createdAt: new Date(),
    });
    console.log(`[webhook] transaction saved for session ${session.id}`);
  }
}

async function handleInvoicePaid(invoice) {
  if (invoice.billing_reason === "subscription_create") {
    return;
  }

  const stripeSubId =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!stripeSubId) return;

  const vendor = await findVendorForSubscription(null, stripeSubId);
  if (!vendor) return;

  let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(stripeSubId);
    periodEnd = getSubscriptionPeriodEnd(subscription);
  } catch {
    // fallback
  }

  const usersCollection = getUsersCollection();
  await usersCollection.updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: periodEnd,
        updatedAt: new Date(),
      },
    }
  );

  const transactionsCollection = getTransactionsCollection();
  const existingTx = await transactionsCollection.findOne({ stripeInvoiceId: invoice.id });
  if (!existingTx) {
    await transactionsCollection.insertOne({
      vendorId: vendor._id.toString(),
      plan: "premium",
      amount: (invoice.amount_paid || 0) / 100,
      currency: (invoice.currency || "usd").toUpperCase(),
      status: TRANSACTION_STATUS.COMPLETED,
      type: "subscription_cycle",
      stripeInvoiceId: invoice.id,
      stripeSubscriptionId: stripeSubId,
      createdAt: new Date(),
    });
    console.log(`[webhook] transaction saved for session ${invoice.id}`);
  }
}

async function handleInvoicePaymentFailed(invoice) {
  const stripeSubId =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!stripeSubId) return;

  const vendor = await findVendorForSubscription(null, stripeSubId);
  if (!vendor) return;

  const transactionsCollection = getTransactionsCollection();
  const existingTx = await transactionsCollection.findOne({ stripeInvoiceId: invoice.id });
  if (!existingTx) {
    await transactionsCollection.insertOne({
      vendorId: vendor._id.toString(),
      amount: (invoice.amount_due || 0) / 100,
      currency: (invoice.currency || "usd").toUpperCase(),
      status: TRANSACTION_STATUS.FAILED,
      type: "invoice_failed",
      stripeInvoiceId: invoice.id,
      stripeSubscriptionId: stripeSubId,
      createdAt: new Date(),
    });
  }
}

async function handleSubscriptionDeleted(subscription) {
  const stripeSubId = subscription.id;
  const vendor = await findVendorForSubscription(null, stripeSubId);
  if (!vendor) return;

  const usersCollection = getUsersCollection();
  const servicesCollection = getServicesCollection();

  await usersCollection.updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionPlan: "free",
        subscriptionExpiresAt: null,
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: null,
        updatedAt: new Date(),
      },
    }
  );

  // Downgrade: retain the 3 newest non-rejected active services, deactivate the rest
  const activeServices = await servicesCollection
    .find({
      vendorId: vendor._id.toString(),
      isActive: true,
      status: { $ne: SERVICE_STATUS.REJECTED },
    })
    .sort({ createdAt: -1 })
    .toArray();

  if (activeServices.length > FREE_PLAN_LIMIT) {
    const servicesToDeactivate = activeServices.slice(FREE_PLAN_LIMIT);
    const idsToDeactivate = servicesToDeactivate.map((s) => s._id);

    await servicesCollection.updateMany(
      { _id: { $in: idsToDeactivate } },
      { $set: { isActive: false, updatedAt: new Date() } }
    );
  }
}

async function handleSubscriptionUpdated(subscription) {
  const stripeSubId = subscription.id;
  const vendor = await findVendorForSubscription(null, stripeSubId);
  if (!vendor) return;

  const periodEnd = getSubscriptionPeriodEnd(subscription);
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);

  const usersCollection = getUsersCollection();
  await usersCollection.updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionExpiresAt: periodEnd,
        cancelAtPeriodEnd,
        updatedAt: new Date(),
      },
    }
  );
}

// Stripe webhook route: FIRST route on app, using express.raw directly
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error("[webhook] Missing required environment variable: STRIPE_WEBHOOK_SECRET");
      return res.status(500).json({
        success: false,
        message: "STRIPE_WEBHOOK_SECRET is not configured on the server.",
      });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("[webhook] Missing required environment variable: STRIPE_SECRET_KEY");
      return res.status(500).json({
        success: false,
        message: "STRIPE_SECRET_KEY is not configured on the server.",
      });
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      console.error("[webhook] Missing stripe-signature header");
      return res.status(400).json({
        success: false,
        message: "Missing stripe-signature header.",
      });
    }

    if (!Buffer.isBuffer(req.body)) {
      console.error(`[webhook] body is not raw, type: ${typeof req.body}`);
      return res.status(400).json({
        success: false,
        message: "Webhook body is not raw",
      });
    }

    let event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error(`[webhook] signature failed: ${err.message}`);
      return res.status(400).json({
        success: false,
        message: `Webhook signature verification failed: ${err.message}`,
      });
    }

    console.log(`[webhook] received ${event.type} ${event.id}`);

    try {
      await connectToMongoDB();

      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutSessionCompleted(event.data.object);
          break;
        case "invoice.paid":
          await handleInvoicePaid(event.data.object);
          break;
        case "invoice.payment_failed":
          await handleInvoicePaymentFailed(event.data.object);
          break;
        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(event.data.object);
          break;
        case "customer.subscription.updated":
          await handleSubscriptionUpdated(event.data.object);
          break;
        default:
          break;
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error(`[webhook] failed: ${err.message}`);
      res.status(500).json({
        success: false,
        message: `Webhook handler failed: ${err.message}`,
      });
    }
  }
);

// ============================================================================
// 5. GENERAL MIDDLEWARE (HELMET, CORS, JSON BODY PARSER & DB HELPER)
// ============================================================================
app.use(helmet());

const rawClientUrls = process.env.CLIENT_URL || "";
const allowedOrigins = rawClientUrls
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes(origin.replace(/\/+$/, "")) ||
        allowedOrigins.includes("*")
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// Mount express.json() for all subsequent routes
app.use(express.json());

// Database connection helper for serverless warm starts on general routes
app.use(async (req, res, next) => {
  try {
    if (process.env.MONGODB_URI) {
      await connectToMongoDB();
    }
    next();
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 5. AUTHENTICATION & AUTHORIZATION MIDDLEWARE
// ============================================================================
let jwksInstance = null;
function getJWKS() {
  if (!jwksInstance) {
    const jwksUrlString = process.env.BETTER_AUTH_JWKS_URL;
    if (!jwksUrlString) {
      throw new Error("BETTER_AUTH_JWKS_URL is not configured on the server.");
    }
    jwksInstance = createRemoteJWKSet(new URL(jwksUrlString));
  }
  return jwksInstance;
}

async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token missing or malformed",
      });
    }

    const token = authHeader.split(" ")[1];
    const issuer = process.env.BETTER_AUTH_ISSUER;

    let payload;
    try {
      const verifyOptions = issuer ? { issuer } : {};
      const verifyResult = await jwtVerify(token, getJWKS(), verifyOptions);
      payload = verifyResult.payload;
    } catch {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    const userId = payload.sub;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Token has no valid subject identifier",
      });
    }

    const usersCollection = getUsersCollection();
    let user = null;

    if (ObjectId.isValid(userId)) {
      user = await usersCollection.findOne({
        $or: [{ _id: new ObjectId(userId) }, { _id: userId }, { id: userId }],
      });
    } else {
      user = await usersCollection.findOne({
        $or: [{ _id: userId }, { id: userId }],
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found in system records",
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked. Please contact support.",
      });
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role || "customer",
      subscriptionPlan: user.subscriptionPlan || "free",
      subscriptionExpiresAt: user.subscriptionExpiresAt || null,
    };

    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: requires one of the following roles: ${roles.join(", ")}`,
      });
    }
    next();
  };
}

const verifyCustomer = requireRole(USER_ROLES.CUSTOMER);
const verifyVendor = requireRole(USER_ROLES.VENDOR);
const verifyAdmin = requireRole(USER_ROLES.ADMIN);

function isPremium(user) {
  if (!user || user.subscriptionPlan !== "premium") {
    return false;
  }
  if (!user.subscriptionExpiresAt) {
    return true;
  }
  return new Date(user.subscriptionExpiresAt) > new Date();
}

function validateObjectIdParam(paramName = "id") {
  return (req, res, next) => {
    const value = req.params[paramName];
    if (!ObjectId.isValid(value)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ID format for parameter '${paramName}': ${value}`,
      });
    }
    next();
  };
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateServiceInput(data, isUpdate = false) {
  const { serviceName, category, description, price, location, images } = data;

  if (!isUpdate || serviceName !== undefined) {
    if (!serviceName || typeof serviceName !== "string" || !serviceName.trim()) {
      return { isValid: false, message: "Service name is required." };
    }
    if (serviceName.trim().length > 120) {
      return { isValid: false, message: "Service name cannot exceed 120 characters." };
    }
  }

  if (!isUpdate || category !== undefined) {
    if (!category || !CATEGORIES.includes(category.trim())) {
      return {
        isValid: false,
        message: `Category must be one of: ${CATEGORIES.join(", ")}.`,
      };
    }
  }

  if (!isUpdate || description !== undefined) {
    if (!description || typeof description !== "string" || !description.trim()) {
      return { isValid: false, message: "Description is required." };
    }
  }

  if (!isUpdate || price !== undefined) {
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0) {
      return { isValid: false, message: "Price must be a positive number." };
    }
  }

  if (!isUpdate || location !== undefined) {
    if (!location || typeof location !== "string" || !location.trim()) {
      return { isValid: false, message: "Location is required." };
    }
  }

  if (!isUpdate || images !== undefined) {
    if (!Array.isArray(images) || images.length === 0) {
      return { isValid: false, message: "At least one service image URL is required." };
    }
    const invalidUrl = images.some(
      (img) => typeof img !== "string" || !img.trim().startsWith("http")
    );
    if (invalidUrl) {
      return { isValid: false, message: "All images must be valid HTTP/HTTPS URLs." };
    }
  }

  return { isValid: true };
}

function validateBookingInput(data) {
  const { serviceId, eventDate, eventLocation, message } = data;

  if (!serviceId || !ObjectId.isValid(serviceId)) {
    return { isValid: false, message: "A valid service ID is required." };
  }

  if (!eventDate || typeof eventDate !== "string") {
    return { isValid: false, message: "Event date is required (YYYY-MM-DD)." };
  }

  const parsedDate = new Date(eventDate);
  if (isNaN(parsedDate.getTime())) {
    return { isValid: false, message: "Invalid date format. Use YYYY-MM-DD." };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (parsedDate < today) {
    return { isValid: false, message: "Event date cannot be in the past." };
  }

  if (!eventLocation || typeof eventLocation !== "string" || !eventLocation.trim()) {
    return { isValid: false, message: "Event location is required." };
  }

  if (message && typeof message !== "string") {
    return { isValid: false, message: "Message must be a string." };
  }

  return { isValid: true };
}

// ============================================================================
// 6. PUBLIC ROUTES
// ============================================================================

// GET /
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "WedPlan API Server is running",
  });
});

// GET /api/health
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "WedPlan API running",
  });
});

// GET /api/categories
app.get("/api/categories", (req, res) => {
  res.json({
    success: true,
    count: CATEGORIES.length,
    categories: CATEGORIES,
  });
});

// GET /api/services
app.get("/api/services", async (req, res, next) => {
  try {
    const { search, category, minPrice, maxPrice, sort, page = 1, limit = 9 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 9));
    const skip = (pageNum - 1) * limitNum;

    const query = {
      status: SERVICE_STATUS.APPROVED,
      isActive: true,
    };

    if (search && search.trim()) {
      const sanitized = escapeRegex(search.trim());
      query.$or = [
        { serviceName: { $regex: sanitized, $options: "i" } },
        { location: { $regex: sanitized, $options: "i" } },
        { description: { $regex: sanitized, $options: "i" } },
      ];
    }

    if (category && category.trim()) {
      query.category = category.trim();
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined && !isNaN(Number(minPrice))) {
        query.price.$gte = Number(minPrice);
      }
      if (maxPrice !== undefined && !isNaN(Number(maxPrice))) {
        query.price.$lte = Number(maxPrice);
      }
      if (Object.keys(query.price).length === 0) {
        delete query.price;
      }
    }

    const sortOption = {};
    if (sort === "price_asc") {
      sortOption.price = 1;
    } else if (sort === "price_desc") {
      sortOption.price = -1;
    } else {
      sortOption.createdAt = -1;
    }

    const servicesCollection = getServicesCollection();
    const total = await servicesCollection.countDocuments(query);
    const rawServices = await servicesCollection
      .find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const services = rawServices.map((s) => ({
      ...s,
      id: s._id.toString(),
    }));

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      count: services.length,
      services,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/services/featured
app.get("/api/services/featured", async (req, res, next) => {
  try {
    const servicesCollection = getServicesCollection();
    const rawServices = await servicesCollection
      .find({
        status: SERVICE_STATUS.APPROVED,
        isActive: true,
      })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    const services = rawServices.map((s) => ({
      ...s,
      id: s._id.toString(),
    }));

    res.json({
      success: true,
      count: services.length,
      services,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/services/:id
app.get("/api/services/:id", validateObjectIdParam("id"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const servicesCollection = getServicesCollection();
    const usersCollection = getUsersCollection();

    const service = await servicesCollection.findOne({
      _id: new ObjectId(id),
      status: SERVICE_STATUS.APPROVED,
      isActive: true,
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found or is currently not available.",
      });
    }

    const vendor = await usersCollection.findOne(
      {
        $or: [
          { _id: service.vendorId },
          { id: service.vendorId },
          ...(ObjectId.isValid(service.vendorId) ? [{ _id: new ObjectId(service.vendorId) }] : []),
        ],
      },
      {
        projection: {
          _id: 1,
          id: 1,
          name: 1,
          businessName: 1,
          image: 1,
        },
      }
    );

    res.json({
      success: true,
      service: {
        ...service,
        id: service._id.toString(),
        vendor: vendor
          ? {
              id: vendor._id?.toString() || vendor.id,
              name: vendor.name,
              businessName: vendor.businessName || vendor.name,
              image: vendor.image || "",
            }
          : {
              name: "WedPlan Verified Partner",
              businessName: "WedPlan Verified Partner",
              image: "",
            },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// 7. USER PROFILE ROUTES
// ============================================================================

// GET /api/me
app.get("/api/me", verifyToken, (req, res) => {
  res.json({
    success: true,
    user: req.user,
  });
});

// ============================================================================
// 8. CUSTOMER ROUTES
// ============================================================================

// GET /api/customer/stats
app.get("/api/customer/stats", verifyToken, verifyCustomer, async (req, res, next) => {
  try {
    const bookingsCollection = getBookingsCollection();
    const [totalBookings, pending, accepted, rejected, cancelled] = await Promise.all([
      bookingsCollection.countDocuments({ customerId: req.user.id }),
      bookingsCollection.countDocuments({
        customerId: req.user.id,
        status: BOOKING_STATUS.PENDING,
      }),
      bookingsCollection.countDocuments({
        customerId: req.user.id,
        status: BOOKING_STATUS.ACCEPTED,
      }),
      bookingsCollection.countDocuments({
        customerId: req.user.id,
        status: BOOKING_STATUS.REJECTED,
      }),
      bookingsCollection.countDocuments({
        customerId: req.user.id,
        status: BOOKING_STATUS.CANCELLED,
      }),
    ]);

    res.json({
      success: true,
      stats: {
        totalBookings,
        pendingBookings: pending,
        acceptedBookings: accepted,
        rejectedBookings: rejected,
        cancelledBookings: cancelled,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/bookings
app.post("/api/bookings", verifyToken, verifyCustomer, async (req, res, next) => {
  try {
    const validation = validateBookingInput(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    const { serviceId, eventDate, eventLocation, message } = req.body;
    const servicesCollection = getServicesCollection();
    const bookingsCollection = getBookingsCollection();

    const service = await servicesCollection.findOne({
      _id: new ObjectId(serviceId),
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Wedding service not found.",
      });
    }

    if (service.status !== SERVICE_STATUS.APPROVED || service.isActive !== true) {
      return res.status(400).json({
        success: false,
        message: "This service is currently not available for bookings.",
      });
    }

    if (service.vendorId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot submit a booking request for your own service.",
      });
    }

    const existingActiveBooking = await bookingsCollection.findOne({
      serviceId: new ObjectId(serviceId),
      customerId: req.user.id,
      eventDate,
      status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.ACCEPTED] },
    });

    if (existingActiveBooking) {
      return res.status(409).json({
        success: false,
        message: `You already have an active booking (${existingActiveBooking.status}) for this service on ${eventDate}.`,
      });
    }

    const newBooking = {
      serviceId: new ObjectId(serviceId),
      vendorId: service.vendorId,
      customerId: req.user.id,
      eventDate,
      eventLocation: eventLocation.trim(),
      message: message ? message.trim() : "",
      status: BOOKING_STATUS.PENDING,
      createdAt: new Date(),
    };

    try {
      const insertResult = await bookingsCollection.insertOne(newBooking);
      res.status(201).json({
        success: true,
        message: "Booking request submitted successfully.",
        booking: {
          id: insertResult.insertedId.toString(),
          _id: insertResult.insertedId,
          serviceName: service.serviceName,
          ...newBooking,
        },
      });
    } catch (insertErr) {
      if (insertErr.code === 11000) {
        return res.status(409).json({
          success: false,
          message: `You already have an active booking for this service on ${eventDate}.`,
        });
      }
      throw insertErr;
    }
  } catch (error) {
    next(error);
  }
});

// GET /api/bookings/my
app.get("/api/bookings/my", verifyToken, verifyCustomer, async (req, res, next) => {
  try {
    const bookingsCollection = getBookingsCollection();
    const servicesCollection = getServicesCollection();
    const usersCollection = getUsersCollection();

    const rawBookings = await bookingsCollection
      .find({ customerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    if (rawBookings.length === 0) {
      return res.json({ success: true, count: 0, bookings: [] });
    }

    const serviceIds = rawBookings
      .map((b) => (ObjectId.isValid(b.serviceId) ? new ObjectId(b.serviceId) : null))
      .filter(Boolean);
    const vendorIds = rawBookings.map((b) => b.vendorId).filter(Boolean);

    const [services, vendors] = await Promise.all([
      serviceIds.length > 0
        ? servicesCollection.find({ _id: { $in: serviceIds } }).toArray()
        : [],
      vendorIds.length > 0
        ? usersCollection
            .find(
              {
                $or: vendorIds.flatMap((vid) => [
                  { _id: vid },
                  { id: vid },
                  ...(ObjectId.isValid(vid) ? [{ _id: new ObjectId(vid) }] : []),
                ]),
              },
              { projection: { _id: 1, id: 1, name: 1, businessName: 1, image: 1 } }
            )
            .toArray()
        : [],
    ]);

    const serviceMap = new Map();
    services.forEach((s) => serviceMap.set(s._id.toString(), s));

    const vendorMap = new Map();
    vendors.forEach((v) => {
      const data = {
        name: v.name || "",
        businessName: v.businessName || v.name || "",
        image: v.image || "",
      };
      if (v._id) vendorMap.set(v._id.toString(), data);
      if (v.id) vendorMap.set(v.id, data);
    });

    const bookings = rawBookings.map((b) => {
      const service = serviceMap.get(b.serviceId?.toString());
      const vendor = vendorMap.get(b.vendorId?.toString());

      return {
        id: b._id.toString(),
        _id: b._id,
        serviceId: b.serviceId,
        vendorId: b.vendorId,
        customerId: b.customerId,
        eventDate: b.eventDate,
        eventLocation: b.eventLocation,
        message: b.message || "",
        status: b.status,
        createdAt: b.createdAt,
        serviceName: service ? service.serviceName : "Service no longer available",
        serviceImage:
          service && Array.isArray(service.images) && service.images.length > 0
            ? service.images[0]
            : "",
        vendor: vendor || {
          name: "WedPlan Partner",
          businessName: "WedPlan Partner",
          image: "",
        },
        vendorName: vendor ? vendor.businessName || vendor.name : "WedPlan Partner",
        vendorImage: vendor ? vendor.image : "",
      };
    });

    res.json({
      success: true,
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/bookings/:id
app.get("/api/bookings/:id", verifyToken, validateObjectIdParam("id"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const bookingsCollection = getBookingsCollection();
    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const isCustomerOwner = booking.customerId === req.user.id;
    const isVendorOwner = booking.vendorId === req.user.id;

    if (!isCustomerOwner && !isVendorOwner) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to view this booking",
      });
    }

    const servicesCollection = getServicesCollection();
    const usersCollection = getUsersCollection();

    const [service, customer, vendor] = await Promise.all([
      servicesCollection.findOne({ _id: new ObjectId(booking.serviceId) }),
      usersCollection.findOne(
        {
          $or: [
            { _id: booking.customerId },
            { id: booking.customerId },
            ...(ObjectId.isValid(booking.customerId) ? [{ _id: new ObjectId(booking.customerId) }] : []),
          ],
        },
        { projection: { _id: 1, id: 1, name: 1, email: 1, image: 1 } }
      ),
      usersCollection.findOne(
        {
          $or: [
            { _id: booking.vendorId },
            { id: booking.vendorId },
            ...(ObjectId.isValid(booking.vendorId) ? [{ _id: new ObjectId(booking.vendorId) }] : []),
          ],
        },
        { projection: { _id: 1, id: 1, name: 1, businessName: 1, image: 1 } }
      ),
    ]);

    res.json({
      success: true,
      booking: {
        id: booking._id.toString(),
        _id: booking._id,
        serviceId: booking.serviceId,
        vendorId: booking.vendorId,
        customerId: booking.customerId,
        eventDate: booking.eventDate,
        eventLocation: booking.eventLocation,
        message: booking.message || "",
        status: booking.status,
        createdAt: booking.createdAt,
        service: service
          ? {
              id: service._id.toString(),
              serviceName: service.serviceName,
              category: service.category,
              price: service.price,
              location: service.location,
              images: service.images || [],
            }
          : {
              serviceName: "Service no longer available",
              images: [],
            },
        vendor: vendor
          ? {
              name: vendor.name,
              businessName: vendor.businessName || vendor.name,
              image: vendor.image || "",
            }
          : null,
        customer:
          isVendorOwner && customer
            ? {
                name: customer.name,
                email: customer.email,
                image: customer.image || "",
              }
            : undefined,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/bookings/:id/cancel
app.patch(
  "/api/bookings/:id/cancel",
  verifyToken,
  verifyCustomer,
  validateObjectIdParam("id"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const bookingId = new ObjectId(id);
      const bookingsCollection = getBookingsCollection();

      const updateResult = await bookingsCollection.updateOne(
        {
          _id: bookingId,
          customerId: req.user.id,
          status: BOOKING_STATUS.PENDING,
        },
        {
          $set: {
            status: BOOKING_STATUS.CANCELLED,
            cancelledAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );

      if (updateResult.modifiedCount === 0) {
        const booking = await bookingsCollection.findOne({ _id: bookingId });
        if (!booking) {
          return res.status(404).json({ success: false, message: "Booking not found" });
        }
        if (booking.customerId !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: "Forbidden: You are not authorized to cancel this booking",
          });
        }
        return res.status(409).json({
          success: false,
          message: `Booking cannot be cancelled because its current status is '${booking.status}'. Only pending bookings can be cancelled.`,
        });
      }

      res.json({
        success: true,
        message: "Booking request cancelled successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// 9. VENDOR ROUTES
// ============================================================================

// GET /api/vendor/stats
app.get("/api/vendor/stats", verifyToken, verifyVendor, async (req, res, next) => {
  try {
    const servicesCollection = getServicesCollection();
    const bookingsCollection = getBookingsCollection();

    const [totalServices, activeServices, totalBookings, pendingBookings, acceptedBookings] =
      await Promise.all([
        servicesCollection.countDocuments({ vendorId: req.user.id }),
        servicesCollection.countDocuments({
          vendorId: req.user.id,
          isActive: true,
          status: SERVICE_STATUS.APPROVED,
        }),
        bookingsCollection.countDocuments({ vendorId: req.user.id }),
        bookingsCollection.countDocuments({
          vendorId: req.user.id,
          status: BOOKING_STATUS.PENDING,
        }),
        bookingsCollection.countDocuments({
          vendorId: req.user.id,
          status: BOOKING_STATUS.ACCEPTED,
        }),
      ]);

    const acceptedBookingDocs = await bookingsCollection
      .find({
        vendorId: req.user.id,
        status: BOOKING_STATUS.ACCEPTED,
      })
      .toArray();

    const serviceIds = acceptedBookingDocs
      .map((b) => (ObjectId.isValid(b.serviceId) ? new ObjectId(b.serviceId) : null))
      .filter(Boolean);

    let earnings = 0;
    if (serviceIds.length > 0) {
      const services = await servicesCollection.find({ _id: { $in: serviceIds } }).toArray();
      const priceMap = new Map();
      services.forEach((s) => priceMap.set(s._id.toString(), s.price || 0));

      for (const booking of acceptedBookingDocs) {
        earnings += priceMap.get(booking.serviceId?.toString()) || 0;
      }
    }

    res.json({
      success: true,
      stats: {
        totalServices,
        activeServices,
        totalBookings,
        pendingBookings,
        acceptedBookings,
        earnings,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/vendor/subscription
app.get("/api/vendor/subscription", verifyToken, verifyVendor, async (req, res, next) => {
  try {
    const usersCollection = getUsersCollection();
    const transactionsCollection = getTransactionsCollection();

    let vendor = await usersCollection.findOne({
      $or: [
        { _id: req.user.id },
        { id: req.user.id },
        ...(ObjectId.isValid(req.user.id) ? [{ _id: new ObjectId(req.user.id) }] : []),
      ],
    });

    // If vendor is not premium in DB, verify directly with Stripe
    if (vendor && !isPremium(vendor) && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = getStripe();
        let sessionToVerify = null;

        const candidateSessionId = req.query.session_id || vendor.pendingStripeSessionId;
        if (candidateSessionId) {
          try {
            sessionToVerify = await stripe.checkout.sessions.retrieve(candidateSessionId);
          } catch {
            // ignore
          }
        }

        if (
          !sessionToVerify ||
          sessionToVerify.status !== "complete" ||
          (sessionToVerify.payment_status !== "paid" && sessionToVerify.payment_status !== "no_payment_required")
        ) {
          // Look up recent sessions on Stripe matching this vendor
          const list = await stripe.checkout.sessions.list({ limit: 10 });
          sessionToVerify = list.data.find(
            (s) =>
              (s.metadata?.vendorId === req.user.id ||
                s.client_reference_id === req.user.id ||
                s.customer_email === req.user.email) &&
              s.status === "complete" &&
              (s.payment_status === "paid" || s.payment_status === "no_payment_required")
          );
        }

        if (
          sessionToVerify &&
          sessionToVerify.status === "complete" &&
          (sessionToVerify.payment_status === "paid" || sessionToVerify.payment_status === "no_payment_required")
        ) {
          await handleCheckoutSessionCompleted(sessionToVerify);
          await usersCollection.updateOne(
            { _id: vendor._id },
            { $unset: { pendingStripeSessionId: "" } }
          );
          vendor = await usersCollection.findOne({ _id: vendor._id });
        }
      } catch (checkErr) {
        console.error("[subscription-verify] Direct Stripe check error:", checkErr.message);
      }
    }

    const transactions = await transactionsCollection
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      subscription: {
        plan: vendor?.subscriptionPlan || "free",
        expiresAt: vendor?.subscriptionExpiresAt || null,
        cancelAtPeriodEnd: Boolean(vendor?.cancelAtPeriodEnd),
        isPremium: isPremium(vendor),
        hasStripeSubscription: Boolean(vendor?.stripeSubscriptionId),
        transactions: transactions.map((t) => ({
          ...t,
          id: t._id.toString(),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/vendor/services
app.post("/api/vendor/services", verifyToken, verifyVendor, async (req, res, next) => {
  try {
    const validation = validateServiceInput(req.body, false);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    const servicesCollection = getServicesCollection();
    const activeCount = await servicesCollection.countDocuments({
      vendorId: req.user.id,
      isActive: true,
      status: { $ne: SERVICE_STATUS.REJECTED },
    });

    if (!isPremium(req.user) && activeCount >= FREE_PLAN_LIMIT) {
      return res.status(403).json({
        success: false,
        message: `Free plan allows a maximum of ${FREE_PLAN_LIMIT} active services. Please upgrade to Premium to publish unlimited services.`,
      });
    }

    const { serviceName, category, description, price, location, images } = req.body;
    const newService = {
      vendorId: req.user.id,
      serviceName: serviceName.trim(),
      category: category.trim(),
      description: description.trim(),
      price: Number(price),
      location: location.trim(),
      images: images.map((img) => img.trim()),
      status: SERVICE_STATUS.PENDING,
      isActive: true,
      createdAt: new Date(),
    };

    const insertResult = await servicesCollection.insertOne(newService);

    res.status(201).json({
      success: true,
      message: "Service created successfully and is pending admin approval.",
      service: {
        id: insertResult.insertedId.toString(),
        _id: insertResult.insertedId,
        ...newService,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/vendor/services
app.get("/api/vendor/services", verifyToken, verifyVendor, async (req, res, next) => {
  try {
    const servicesCollection = getServicesCollection();
    const services = await servicesCollection
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      count: services.length,
      services: services.map((s) => ({
        ...s,
        id: s._id.toString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/vendor/services/:id
app.get(
  "/api/vendor/services/:id",
  verifyToken,
  verifyVendor,
  validateObjectIdParam("id"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const servicesCollection = getServicesCollection();
      const service = await servicesCollection.findOne({ _id: new ObjectId(id) });

      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      if (service.vendorId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You do not own this service",
        });
      }

      res.json({
        success: true,
        service: {
          ...service,
          id: service._id.toString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/vendor/services/:id
app.patch(
  "/api/vendor/services/:id",
  verifyToken,
  verifyVendor,
  validateObjectIdParam("id"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const validation = validateServiceInput(req.body, true);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          message: validation.message,
        });
      }

      const servicesCollection = getServicesCollection();
      const service = await servicesCollection.findOne({ _id: new ObjectId(id) });

      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      if (service.vendorId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You do not own this service",
        });
      }

      const updates = {};
      const { serviceName, category, description, price, location, images } = req.body;

      if (serviceName !== undefined) updates.serviceName = serviceName.trim();
      if (category !== undefined) updates.category = category.trim();
      if (description !== undefined) updates.description = description.trim();
      if (price !== undefined) updates.price = Number(price);
      if (location !== undefined) updates.location = location.trim();
      if (images !== undefined) updates.images = images.map((img) => img.trim());

      updates.updatedAt = new Date();

      await servicesCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });
      const updated = await servicesCollection.findOne({ _id: new ObjectId(id) });

      res.json({
        success: true,
        message: "Service updated successfully",
        service: {
          ...updated,
          id: updated._id.toString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/vendor/services/:id/availability
app.patch(
  "/api/vendor/services/:id/availability",
  verifyToken,
  verifyVendor,
  validateObjectIdParam("id"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "'isActive' must be a boolean (true or false).",
        });
      }

      const servicesCollection = getServicesCollection();
      const service = await servicesCollection.findOne({ _id: new ObjectId(id) });

      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      if (service.vendorId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You do not own this service",
        });
      }

      if (isActive) {
        if (service.status === SERVICE_STATUS.REJECTED) {
          return res.status(400).json({
            success: false,
            message: "Rejected services cannot be marked as active.",
          });
        }

        if (!service.isActive) {
          const activeCount = await servicesCollection.countDocuments({
            vendorId: req.user.id,
            isActive: true,
            status: { $ne: SERVICE_STATUS.REJECTED },
          });

          if (!isPremium(req.user) && activeCount >= FREE_PLAN_LIMIT) {
            return res.status(403).json({
              success: false,
              message: `Free plan limit reached (${FREE_PLAN_LIMIT} active services). Please upgrade to Premium or deactivate another service first.`,
            });
          }
        }
      }

      await servicesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isActive, updatedAt: new Date() } }
      );

      res.json({
        success: true,
        message: `Service availability set to ${isActive ? "active" : "inactive"}`,
        isActive,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/vendor/services/:id
app.delete(
  "/api/vendor/services/:id",
  verifyToken,
  verifyVendor,
  validateObjectIdParam("id"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const servicesCollection = getServicesCollection();
      const service = await servicesCollection.findOne({ _id: new ObjectId(id) });

      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      if (service.vendorId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You do not own this service",
        });
      }

      await servicesCollection.deleteOne({ _id: new ObjectId(id) });

      res.json({
        success: true,
        message: "Service deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/vendor/bookings
app.get("/api/vendor/bookings", verifyToken, verifyVendor, async (req, res, next) => {
  try {
    const bookingsCollection = getBookingsCollection();
    const servicesCollection = getServicesCollection();
    const usersCollection = getUsersCollection();

    const rawBookings = await bookingsCollection
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    if (rawBookings.length === 0) {
      return res.json({ success: true, count: 0, bookings: [] });
    }

    const serviceIds = rawBookings
      .map((b) => (ObjectId.isValid(b.serviceId) ? new ObjectId(b.serviceId) : null))
      .filter(Boolean);
    const customerIds = rawBookings.map((b) => b.customerId).filter(Boolean);

    const [services, customers] = await Promise.all([
      serviceIds.length > 0
        ? servicesCollection.find({ _id: { $in: serviceIds } }).toArray()
        : [],
      customerIds.length > 0
        ? usersCollection
            .find(
              {
                $or: customerIds.flatMap((cid) => [
                  { _id: cid },
                  { id: cid },
                  ...(ObjectId.isValid(cid) ? [{ _id: new ObjectId(cid) }] : []),
                ]),
              },
              { projection: { _id: 1, id: 1, name: 1, email: 1, image: 1 } }
            )
            .toArray()
        : [],
    ]);

    const serviceMap = new Map();
    services.forEach((s) => serviceMap.set(s._id.toString(), s));

    const customerMap = new Map();
    customers.forEach((c) => {
      const data = {
        name: c.name || "Customer",
        email: c.email || "",
        image: c.image || "",
      };
      if (c._id) customerMap.set(c._id.toString(), data);
      if (c.id) customerMap.set(c.id, data);
    });

    const bookings = rawBookings.map((b) => {
      const service = serviceMap.get(b.serviceId?.toString());
      const customer = customerMap.get(b.customerId?.toString());

      return {
        id: b._id.toString(),
        _id: b._id,
        serviceId: b.serviceId,
        vendorId: b.vendorId,
        customerId: b.customerId,
        eventDate: b.eventDate,
        eventLocation: b.eventLocation,
        message: b.message || "",
        status: b.status,
        createdAt: b.createdAt,
        serviceName: service ? service.serviceName : "Service no longer available",
        serviceImage:
          service && Array.isArray(service.images) && service.images.length > 0
            ? service.images[0]
            : "",
        customer: customer || {
          name: "Customer",
          email: "",
          image: "",
        },
      };
    });

    res.json({
      success: true,
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/vendor/bookings/:id/status
app.patch(
  "/api/vendor/bookings/:id/status",
  verifyToken,
  verifyVendor,
  validateObjectIdParam("id"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || ![BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.REJECTED].includes(status.toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Vendors may only set status to 'accepted' or 'rejected'.",
        });
      }

      const targetStatus = status.toLowerCase();
      const bookingId = new ObjectId(id);
      const bookingsCollection = getBookingsCollection();

      const updateResult = await bookingsCollection.updateOne(
        {
          _id: bookingId,
          vendorId: req.user.id,
          status: BOOKING_STATUS.PENDING,
        },
        {
          $set: {
            status: targetStatus,
            updatedAt: new Date(),
          },
        }
      );

      if (updateResult.modifiedCount === 0) {
        const booking = await bookingsCollection.findOne({ _id: bookingId });
        if (!booking) {
          return res.status(404).json({ success: false, message: "Booking not found" });
        }
        if (booking.vendorId !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: "Forbidden: You are not authorized to update this booking",
          });
        }
        return res.status(409).json({
          success: false,
          message: `Booking cannot be updated because its current status is '${booking.status}'. Only pending bookings can be accepted or rejected.`,
        });
      }

      res.json({
        success: true,
        message: `Booking request has been ${targetStatus}`,
        status: targetStatus,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// 10. PAYMENT ROUTES (STRIPE CHECKOUT)
// ============================================================================

// POST /api/payments/create-checkout-session
app.post("/api/payments/create-checkout-session", verifyToken, verifyVendor, async (req, res, next) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("[create-checkout-session] Missing required environment variable: STRIPE_SECRET_KEY");
      return res.status(500).json({ success: false, message: "STRIPE_SECRET_KEY is not configured on the server." });
    }
    if (!process.env.STRIPE_PRICE_ID) {
      console.error("[create-checkout-session] Missing required environment variable: STRIPE_PRICE_ID");
      return res.status(500).json({ success: false, message: "STRIPE_PRICE_ID is not configured on the server." });
    }
    if (!process.env.CLIENT_URL) {
      console.error("[create-checkout-session] Missing required environment variable: CLIENT_URL");
      return res.status(500).json({ success: false, message: "CLIENT_URL is not configured on the server." });
    }

    if (isPremium(req.user)) {
      return res.status(409).json({
        success: false,
        message: "You already have an active Premium subscription.",
      });
    }

    const primaryClientUrl = allowedOrigins[0] || process.env.CLIENT_URL.split(",")[0].trim().replace(/\/+$/, "");
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      client_reference_id: req.user.id,
      customer_email: req.user.email,
      metadata: {
        vendorId: req.user.id,
      },
      subscription_data: {
        metadata: {
          vendorId: req.user.id,
        },
      },
      success_url: `${primaryClientUrl}/dashboard/vendor/subscription?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${primaryClientUrl}/dashboard/vendor/subscription?canceled=true`,
    });

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });

    // Record pending session ID for instant verification upon return
    try {
      const usersCollection = getUsersCollection();
      await usersCollection.updateOne(
        {
          $or: [
            { _id: req.user.id },
            { id: req.user.id },
            ...(ObjectId.isValid(req.user.id) ? [{ _id: new ObjectId(req.user.id) }] : []),
          ],
        },
        {
          $set: {
            pendingStripeSessionId: session.id,
            updatedAt: new Date(),
          },
        }
      );
    } catch {
      // non-critical
    }
  } catch (error) {
    console.error("[create-checkout-session] failed:", error.message, error.type, error.code);
    next(error);
  }
});

// GET /api/payments/session-status
app.get("/api/payments/session-status", verifyToken, verifyVendor, async (req, res, next) => {
  try {
    const { session_id } = req.query;
    if (!session_id || typeof session_id !== "string") {
      return res.status(400).json({
        success: false,
        message: "session_id query parameter is required",
      });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(session_id);

    const sessionVendorId = session.metadata?.vendorId || session.client_reference_id;
    if (sessionVendorId && sessionVendorId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to query this session",
      });
    }

    const usersCollection = getUsersCollection();
    let vendor = await usersCollection.findOne({
      $or: [
        { _id: req.user.id },
        { id: req.user.id },
        ...(ObjectId.isValid(req.user.id) ? [{ _id: new ObjectId(req.user.id) }] : []),
      ],
    });

    // If Stripe confirms payment but vendor in DB is still free, activate immediately
    if (
      session.status === "complete" &&
      (session.payment_status === "paid" || session.payment_status === "no_payment_required") &&
      vendor &&
      !isPremium(vendor)
    ) {
      await handleCheckoutSessionCompleted(session);
      await usersCollection.updateOne(
        { _id: vendor._id },
        { $unset: { pendingStripeSessionId: "" } }
      );
      vendor = await usersCollection.findOne({ _id: vendor._id });
    }

    res.json({
      success: true,
      status: session.status,
      payment_status: session.payment_status,
      isPremium: isPremium(vendor),
      subscriptionExpiresAt: vendor?.subscriptionExpiresAt || null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/payments/cancel-subscription
app.post("/api/payments/cancel-subscription", verifyToken, verifyVendor, async (req, res, next) => {
  try {
    const usersCollection = getUsersCollection();
    const vendor = await usersCollection.findOne({
      $or: [
        { _id: req.user.id },
        { id: req.user.id },
        ...(ObjectId.isValid(req.user.id) ? [{ _id: new ObjectId(req.user.id) }] : []),
      ],
    });

    if (!vendor || !vendor.stripeSubscriptionId) {
      return res.status(404).json({
        success: false,
        message: "No active Stripe subscription found for your account.",
      });
    }

    const stripe = getStripe();
    const updatedSub = await stripe.subscriptions.update(vendor.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    const periodEnd = getSubscriptionPeriodEnd(updatedSub);

    await usersCollection.updateOne(
      { _id: vendor._id },
      {
        $set: {
          cancelAtPeriodEnd: true,
          subscriptionExpiresAt: periodEnd,
          updatedAt: new Date(),
        },
      }
    );

    res.json({
      success: true,
      message: "Subscription will be canceled at the end of the current billing cycle.",
      expiresAt: periodEnd,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// 11. ADMIN ROUTES
// ============================================================================

// GET /api/admin/stats
app.get("/api/admin/stats", verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const usersCollection = getUsersCollection();
    const servicesCollection = getServicesCollection();
    const bookingsCollection = getBookingsCollection();
    const transactionsCollection = getTransactionsCollection();

    const [
      totalUsers,
      totalVendors,
      totalCustomers,
      totalServices,
      pendingServices,
      approvedServices,
      rejectedServices,
      totalBookings,
      pendingBookings,
      completedTransactions,
    ] = await Promise.all([
      usersCollection.countDocuments(),
      usersCollection.countDocuments({ role: USER_ROLES.VENDOR }),
      usersCollection.countDocuments({ role: USER_ROLES.CUSTOMER }),
      servicesCollection.countDocuments(),
      servicesCollection.countDocuments({ status: SERVICE_STATUS.PENDING }),
      servicesCollection.countDocuments({ status: SERVICE_STATUS.APPROVED }),
      servicesCollection.countDocuments({ status: SERVICE_STATUS.REJECTED }),
      bookingsCollection.countDocuments(),
      bookingsCollection.countDocuments({ status: BOOKING_STATUS.PENDING }),
      transactionsCollection.find({ status: TRANSACTION_STATUS.COMPLETED }).toArray(),
    ]);

    const totalRevenue = completedTransactions.reduce(
      (sum, tx) => sum + (Number(tx.amount) || 0),
      0
    );

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalVendors,
        totalCustomers,
        totalServices,
        pendingServices,
        approvedServices,
        rejectedServices,
        totalBookings,
        pendingBookings,
        totalTransactions: completedTransactions.length,
        totalRevenue,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/users
app.get("/api/admin/users", verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const { search, role, page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (search && search.trim()) {
      const sanitized = escapeRegex(search.trim());
      query.$or = [
        { name: { $regex: sanitized, $options: "i" } },
        { email: { $regex: sanitized, $options: "i" } },
      ];
    }

    if (role && Object.values(USER_ROLES).includes(role.toLowerCase().trim())) {
      query.role = role.toLowerCase().trim();
    }

    const usersCollection = getUsersCollection();
    const total = await usersCollection.countDocuments(query);
    const users = await usersCollection
      .find(query, {
        projection: {
          _id: 1,
          id: 1,
          name: 1,
          email: 1,
          role: 1,
          isBlocked: 1,
          subscriptionPlan: 1,
          subscriptionExpiresAt: 1,
          createdAt: 1,
          image: 1,
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      users: users.map((u) => ({
        ...u,
        id: u._id.toString(),
        isBlocked: Boolean(u.isBlocked),
        subscriptionPlan: u.subscriptionPlan || "free",
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/users/:id
app.get("/api/admin/users/:id", verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const usersCollection = getUsersCollection();
    const servicesCollection = getServicesCollection();
    const bookingsCollection = getBookingsCollection();

    const user = await usersCollection.findOne(
      {
        $or: [
          { _id: id },
          { id: id },
          ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
        ],
      },
      {
        projection: {
          _id: 1,
          id: 1,
          name: 1,
          email: 1,
          role: 1,
          isBlocked: 1,
          subscriptionPlan: 1,
          subscriptionExpiresAt: 1,
          createdAt: 1,
          image: 1,
        },
      }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const userIdStr = user._id.toString();
    const [servicesCount, bookingsCount] = await Promise.all([
      user.role === USER_ROLES.VENDOR
        ? servicesCollection.countDocuments({ vendorId: userIdStr })
        : 0,
      user.role === USER_ROLES.CUSTOMER
        ? bookingsCollection.countDocuments({ customerId: userIdStr })
        : bookingsCollection.countDocuments({ vendorId: userIdStr }),
    ]);

    res.json({
      success: true,
      user: {
        ...user,
        id: userIdStr,
        isBlocked: Boolean(user.isBlocked),
        servicesCount,
        bookingsCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/users/:id/block
app.patch("/api/admin/users/:id/block", verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const usersCollection = getUsersCollection();

    const targetUser = await usersCollection.findOne({
      $or: [
        { _id: id },
        { id: id },
        ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
      ],
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (targetUser._id.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot block your own administrative account.",
      });
    }

    if (targetUser.role === USER_ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: "Administrative accounts cannot be blocked.",
      });
    }

    await usersCollection.updateOne(
      { _id: targetUser._id },
      { $set: { isBlocked: true, updatedAt: new Date() } }
    );

    try {
      const sessions = database.collection("session");
      await sessions.deleteMany({
        $or: [
          { userId: targetUser._id.toString() },
          { userId: targetUser._id },
          ...(targetUser.id ? [{ userId: targetUser.id }] : []),
        ],
      });
    } catch {
      // sessions table optional
    }

    res.json({
      success: true,
      message: `User ${targetUser.email} has been blocked and active sessions revoked.`,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/users/:id/unblock
app.patch("/api/admin/users/:id/unblock", verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const usersCollection = getUsersCollection();

    const targetUser = await usersCollection.findOne({
      $or: [
        { _id: id },
        { id: id },
        ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
      ],
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await usersCollection.updateOne(
      { _id: targetUser._id },
      { $set: { isBlocked: false, updatedAt: new Date() } }
    );

    res.json({
      success: true,
      message: `User ${targetUser.email} has been unblocked.`,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/services
app.get("/api/admin/services", verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const { search, category, status, page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (search && search.trim()) {
      const sanitized = escapeRegex(search.trim());
      query.$or = [
        { serviceName: { $regex: sanitized, $options: "i" } },
        { location: { $regex: sanitized, $options: "i" } },
      ];
    }

    if (category && category.trim()) {
      query.category = category.trim();
    }

    if (status && Object.values(SERVICE_STATUS).includes(status.toLowerCase().trim())) {
      query.status = status.toLowerCase().trim();
    }

    const servicesCollection = getServicesCollection();
    const usersCollection = getUsersCollection();

    const total = await servicesCollection.countDocuments(query);
    const rawServices = await servicesCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    if (rawServices.length === 0) {
      return res.json({
        success: true,
        total: 0,
        page: pageNum,
        limit: limitNum,
        totalPages: 0,
        services: [],
      });
    }

    const vendorIds = rawServices.map((s) => s.vendorId).filter(Boolean);
    const conditions = [];
    for (const vid of vendorIds) {
      conditions.push({ _id: vid }, { id: vid });
      if (ObjectId.isValid(vid)) {
        conditions.push({ _id: new ObjectId(vid) });
      }
    }

    const vendors = conditions.length > 0
      ? await usersCollection
          .find(
            { $or: conditions },
            { projection: { _id: 1, id: 1, name: 1, email: 1, businessName: 1 } }
          )
          .toArray()
      : [];

    const vendorMap = new Map();
    for (const v of vendors) {
      const data = {
        name: v.name || "",
        email: v.email || "",
        businessName: v.businessName || v.name || "",
      };
      if (v._id) vendorMap.set(v._id.toString(), data);
      if (v.id) vendorMap.set(v.id, data);
    }

    const services = rawServices.map((s) => ({
      ...s,
      id: s._id.toString(),
      vendor: vendorMap.get(s.vendorId) || {
        name: "Unknown Vendor",
        email: "",
        businessName: "",
      },
    }));

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      services,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/services/:id
app.get(
  "/api/admin/services/:id",
  verifyToken,
  verifyAdmin,
  validateObjectIdParam("id"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const servicesCollection = getServicesCollection();
      const usersCollection = getUsersCollection();

      const service = await servicesCollection.findOne({ _id: new ObjectId(id) });
      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      const vendor = await usersCollection.findOne(
        {
          $or: [
            { _id: service.vendorId },
            { id: service.vendorId },
            ...(ObjectId.isValid(service.vendorId) ? [{ _id: new ObjectId(service.vendorId) }] : []),
          ],
        },
        { projection: { _id: 1, id: 1, name: 1, email: 1, businessName: 1, image: 1 } }
      );

      res.json({
        success: true,
        service: {
          ...service,
          id: service._id.toString(),
          vendor: vendor
            ? {
                id: vendor._id?.toString() || vendor.id,
                name: vendor.name,
                email: vendor.email,
                businessName: vendor.businessName || vendor.name,
                image: vendor.image || "",
              }
            : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/admin/services/:id/status
app.patch(
  "/api/admin/services/:id/status",
  verifyToken,
  verifyAdmin,
  validateObjectIdParam("id"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !Object.values(SERVICE_STATUS).includes(status.toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${Object.values(SERVICE_STATUS).join(", ")}.`,
        });
      }

      const targetStatus = status.toLowerCase();
      const servicesCollection = getServicesCollection();

      const service = await servicesCollection.findOne({ _id: new ObjectId(id) });
      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      const updates = {
        status: targetStatus,
        updatedAt: new Date(),
      };

      if (targetStatus === SERVICE_STATUS.REJECTED) {
        updates.isActive = false;
      }

      await servicesCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });

      res.json({
        success: true,
        message: `Service status updated to '${targetStatus}'.`,
        status: targetStatus,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/admin/services/:id
app.delete(
  "/api/admin/services/:id",
  verifyToken,
  verifyAdmin,
  validateObjectIdParam("id"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const servicesCollection = getServicesCollection();

      const service = await servicesCollection.findOne({ _id: new ObjectId(id) });
      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      await servicesCollection.deleteOne({ _id: new ObjectId(id) });

      res.json({
        success: true,
        message: "Service deleted successfully by administrator.",
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/admin/transactions
app.get("/api/admin/transactions", verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const { status } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const query = {};
    if (status && Object.values(TRANSACTION_STATUS).includes(status.toLowerCase().trim())) {
      query.status = status.toLowerCase().trim();
    }

    const transactionsCollection = getTransactionsCollection();
    const usersCollection = getUsersCollection();

    const total = await transactionsCollection.countDocuments(query);
    const rawTransactions = await transactionsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    if (rawTransactions.length === 0) {
      return res.json({
        success: true,
        total: 0,
        page,
        limit,
        transactions: [],
        items: [],
      });
    }

    const vendorIds = rawTransactions.map((t) => t.vendorId).filter(Boolean);
    const conditions = [];
    for (const vid of vendorIds) {
      conditions.push({ _id: vid }, { id: vid });
      if (ObjectId.isValid(vid)) {
        conditions.push({ _id: new ObjectId(vid) });
      }
    }

    const vendors = conditions.length > 0
      ? await usersCollection
          .find(
            { $or: conditions },
            { projection: { _id: 1, id: 1, name: 1, email: 1, businessName: 1 } }
          )
          .toArray()
      : [];

    const vendorMap = new Map();
    for (const v of vendors) {
      const data = {
        name: v.name || "",
        email: v.email || "",
        businessName: v.businessName || v.name || "",
      };
      if (v._id) vendorMap.set(v._id.toString(), data);
      if (v.id) vendorMap.set(v.id, data);
    }

    const items = rawTransactions.map((tx) => ({
      ...tx,
      id: tx._id.toString(),
      vendor: vendorMap.get(tx.vendorId) || {
        name: "Unknown Vendor",
        email: "",
        businessName: "",
      },
    }));

    res.json({
      success: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      transactions: items,
      items,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// 12. CENTRAL 404 & ERROR HANDLING MIDDLEWARE
// ============================================================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Not Found - ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  const statusCode =
    res.statusCode && res.statusCode >= 400
      ? res.statusCode
      : err.status || err.statusCode || 500;

  console.error(`[Error] ${req.method} ${req.originalUrl || req.url}:`, err.message);
  if (err.stack) {
    console.error(err.stack);
  }

  const isProd = process.env.NODE_ENV === "production";
  const message =
    statusCode === 500 && isProd
      ? "Internal server error"
      : err.message || "Internal server error";

  res.status(statusCode).json({
    success: false,
    message,
  });
});

// ============================================================================
// 13. SERVER STARTUP (GUARDED FOR VERCEL) & EXPORT
// ============================================================================
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`WedPlan server listening on port ${port}`);
  });
}

export default app;
