import { MongoClient } from "mongodb";

/**
 * ID Representation Architecture Decision:
 * 1. User IDs (`vendorId`, `customerId`) in business documents (services, bookings, transactions)
 *    are ALWAYS saved as uniform STRINGS (`req.user.id = user._id.toString()`).
 *    This ensures 100% compatibility across Better Auth authentication plugins, whether
 *    users are created with native MongoDB ObjectIds or alphanumeric strings (cuid/nanoid).
 * 2. Primary document IDs (`_id`) for services, bookings, and transactions are native MongoDB `ObjectId`.
 * 3. Foreign service references (`serviceId` in bookings) are native MongoDB `ObjectId`.
 */

let client = null;
let db = null;

export async function connectDB() {
  if (db) {
    return db;
  }

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME || "wedplan";

  if (!uri) {
    throw new Error("MONGODB_URI is not defined in environment variables");
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  console.log(`Connected to MongoDB database: ${dbName}`);

  // Create useful indexes for queries and constraints
  await createIndexes();

  return db;
}

async function createIndexes() {
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

    // Partial unique index: stops race conditions for duplicate active bookings
    // A customer cannot have two pending or accepted bookings for the same service on the same date
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
    // Unique sparse index on Stripe Checkout session ID (idempotent payment recording)
    await transactions.createIndex(
      { stripeSessionId: 1 },
      { unique: true, sparse: true }
    );
    // Unique sparse index on Stripe Invoice ID (idempotent subscription renewal recording)
    await transactions.createIndex(
      { stripeInvoiceId: 1 },
      { unique: true, sparse: true }
    );
    await transactions.createIndex({ vendorId: 1 });
  } catch (err) {
    console.warn("Index creation warning:", err.message);
  }
}

export function getDb() {
  if (!db) {
    throw new Error("Database not connected. Call connectDB() first.");
  }
  return db;
}

export function getUsersCollection() {
  return getDb().collection("users");
}

export function getServicesCollection() {
  return getDb().collection("services");
}

export function getBookingsCollection() {
  return getDb().collection("bookings");
}

export function getTransactionsCollection() {
  return getDb().collection("transactions");
}

export async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
