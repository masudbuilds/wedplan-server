import { ObjectId } from "mongodb";
import { getStripe } from "../config/stripe.js";
import {
  connectDB,
  getUsersCollection,
  getServicesCollection,
  getTransactionsCollection,
} from "../config/db.js";
import { USER_ROLES, SERVICE_STATUS, TRANSACTION_STATUS } from "../utils/constants.js";

/**
 * Helper to safely extract subscription current_period_end.
 * In older Stripe API versions, period dates existed at subscription root.
 * In Basil / 2025-03-31+ / 2026-11-18+, period dates are on subscription.items.data[0].
 */
export function getSubscriptionPeriodEnd(subscription) {
  const timestamp =
    subscription?.current_period_end ??
    subscription?.items?.data?.[0]?.current_period_end ??
    subscription?.items?.data?.[0]?.period?.end;

  if (timestamp) {
    return new Date(timestamp * 1000);
  }

  // Fallback: 30 days from now if not present
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/**
 * Helper to find a vendor by vendorId or stripeSubscriptionId.
 * Strictly verifies that the found user has the "vendor" role.
 */
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

/**
 * 1. Handles checkout.session.completed
 * Activates vendor Premium plan and idempotently creates a completed transaction.
 */
async function handleCheckoutSessionCompleted(session) {
  const isPaid =
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required";

  if (!isPaid) {
    return;
  }

  const vendorId = session.metadata?.vendorId || session.client_reference_id;
  const stripeSubId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  const vendor = await findVendorForSubscription(vendorId, stripeSubId);
  if (!vendor) {
    return;
  }

  let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (stripeSubId) {
    try {
      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(stripeSubId);
      periodEnd = getSubscriptionPeriodEnd(subscription);
    } catch {
      // Use 30-day fallback if retrieval fails
    }
  }

  const usersCollection = getUsersCollection();
  const transactionsCollection = getTransactionsCollection();

  await usersCollection.updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: periodEnd,
        stripeSubscriptionId: stripeSubId || null,
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      },
    }
  );

  try {
    const existing = await transactionsCollection.findOne({
      stripeSessionId: session.id,
    });

    if (!existing) {
      await transactionsCollection.insertOne({
        vendorId: vendor._id.toString(),
        plan: "premium",
        amount: (session.amount_total || 0) / 100,
        currency: session.currency || "usd",
        stripeSessionId: session.id,
        stripeSubscriptionId: stripeSubId || null,
        status: TRANSACTION_STATUS.COMPLETED,
        createdAt: new Date(),
      });
    }
  } catch (txErr) {
    // Gracefully handle duplicate key race condition
    if (txErr.code !== 11000) {
      console.error("Stripe webhook transaction record error:", txErr.message);
      throw txErr;
    }
  }
}

/**
 * 2. Handles invoice.paid (subscription renewals)
 * Extends subscription period and records renewal transaction.
 */
async function handleInvoicePaid(invoice) {
  const stripeSubId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;

  if (!stripeSubId) return;

  const vendorId =
    invoice.subscription_details?.metadata?.vendorId ||
    invoice.metadata?.vendorId;

  const vendor = await findVendorForSubscription(vendorId, stripeSubId);
  if (!vendor) return;

  let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(stripeSubId);
    periodEnd = getSubscriptionPeriodEnd(subscription);
  } catch {
    const lineEnd = invoice.lines?.data?.[0]?.period?.end;
    if (lineEnd) periodEnd = new Date(lineEnd * 1000);
  }

  const usersCollection = getUsersCollection();
  const transactionsCollection = getTransactionsCollection();

  await usersCollection.updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: periodEnd,
        stripeSubscriptionId: stripeSubId,
        updatedAt: new Date(),
      },
    }
  );

  try {
    const existing = await transactionsCollection.findOne({
      stripeInvoiceId: invoice.id,
    });

    if (!existing) {
      await transactionsCollection.insertOne({
        vendorId: vendor._id.toString(),
        plan: "premium",
        amount: (invoice.amount_paid || 0) / 100,
        currency: invoice.currency || "usd",
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: stripeSubId,
        status: TRANSACTION_STATUS.COMPLETED,
        createdAt: new Date(),
      });
    }
  } catch (txErr) {
    if (txErr.code !== 11000) {
      console.error("Stripe webhook invoice transaction error:", txErr.message);
      throw txErr;
    }
  }
}

/**
 * 3. Handles invoice.payment_failed
 * Records a failed transaction record without extending subscription.
 */
async function handleInvoicePaymentFailed(invoice) {
  const stripeSubId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;

  if (!stripeSubId) return;

  const vendorId =
    invoice.subscription_details?.metadata?.vendorId ||
    invoice.metadata?.vendorId;

  const vendor = await findVendorForSubscription(vendorId, stripeSubId);
  if (!vendor) return;

  const transactionsCollection = getTransactionsCollection();

  try {
    const existing = await transactionsCollection.findOne({
      stripeInvoiceId: invoice.id,
    });

    if (!existing) {
      await transactionsCollection.insertOne({
        vendorId: vendor._id.toString(),
        plan: "premium",
        amount: (invoice.amount_due || 0) / 100,
        currency: invoice.currency || "usd",
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: stripeSubId,
        status: TRANSACTION_STATUS.FAILED,
        createdAt: new Date(),
      });
    }
  } catch (txErr) {
    if (txErr.code !== 11000) {
      console.error("Stripe webhook failed invoice transaction error:", txErr.message);
      throw txErr;
    }
  }
}

/**
 * 4. Handles customer.subscription.deleted
 * Downgrades vendor to "free", clears subscriptionExpiresAt, and keeps
 * vendor's 3 newest non-rejected services active while deactivating the rest.
 */
async function handleSubscriptionDeleted(subscription) {
  const vendorId = subscription.metadata?.vendorId;
  const vendor = await findVendorForSubscription(vendorId, subscription.id);
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
        updatedAt: new Date(),
      },
    }
  );

  const vendorServices = await servicesCollection
    .find({
      vendorId: vendor._id.toString(),
      status: { $ne: SERVICE_STATUS.REJECTED },
    })
    .sort({ createdAt: -1 })
    .toArray();

  if (vendorServices.length > 3) {
    const servicesToDeactivate = vendorServices.slice(3);
    const idsToDeactivate = servicesToDeactivate.map((s) => s._id);

    await servicesCollection.updateMany(
      { _id: { $in: idsToDeactivate } },
      { $set: { isActive: false, updatedAt: new Date() } }
    );
  }
}

/**
 * 5. Handles customer.subscription.updated
 * Synchronizes cancel_at_period_end or current_period_end changes.
 */
async function handleSubscriptionUpdated(subscription) {
  const vendorId = subscription.metadata?.vendorId;
  const vendor = await findVendorForSubscription(vendorId, subscription.id);
  if (!vendor) return;

  const periodEnd = getSubscriptionPeriodEnd(subscription);
  const usersCollection = getUsersCollection();

  await usersCollection.updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionExpiresAt: periodEnd,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * POST /api/webhooks/stripe
 * Stripe webhook endpoint. Validates raw body with STRIPE_WEBHOOK_SECRET.
 * No Bearer token auth is used because Stripe invokes this directly.
 */
export async function handleStripeWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error("Stripe webhook: Missing signature or webhook secret configuration.");
    return res.status(400).json({
      success: false,
      message: "Missing Stripe signature or webhook secret configuration.",
    });
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).json({
      success: false,
      message: `Webhook signature verification failed: ${err.message}`,
    });
  }

  try {
    // Ensure active DB connection for webhook processing
    await connectDB();

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
    console.error(`Stripe webhook error processing event "${event.type}":`, err.message);
    res.status(500).json({
      success: false,
      message: `Webhook handler failed: ${err.message}`,
    });
  }
}
