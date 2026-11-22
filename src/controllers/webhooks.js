import { ObjectId } from "mongodb";
import { getStripe } from "../config/stripe.js";
import {
  getUsersCollection,
  getTransactionsCollection,
} from "../config/db.js";
import { USER_ROLES, TRANSACTION_STATUS } from "../utils/constants.js";

/**
 * Helper to safely extract subscription current_period_end.
 * In older Stripe API versions, period dates existed at subscription root.
 * In Basil (2025-03-31+), period dates are on subscription.items.data[0].
 */
export function getSubscriptionPeriodEnd(subscription) {
  const timestamp =
    subscription?.current_period_end ??
    subscription?.items?.data?.[0]?.current_period_end;

  if (timestamp) {
    return new Date(timestamp * 1000);
  }

  // Fallback: 30 days from now if not present
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/**
 * Handles checkout.session.completed
 * Activates vendor Premium plan and idempotently creates a completed transaction.
 */
async function handleCheckoutSessionCompleted(session) {
  if (session.payment_status !== "paid") {
    return;
  }

  const vendorId = session.metadata?.vendorId || session.client_reference_id;
  if (!vendorId) {
    console.warn("Notice: checkout.session.completed received without vendorId.");
    return;
  }

  const usersCollection = getUsersCollection();
  const transactionsCollection = getTransactionsCollection();

  // Confirm vendor exists in DB and has role 'vendor'
  const vendor = await usersCollection.findOne({
    $or: [
      { _id: vendorId },
      { id: vendorId },
      ...(ObjectId.isValid(vendorId) ? [{ _id: new ObjectId(vendorId) }] : []),
    ],
  });

  if (!vendor || vendor.role !== USER_ROLES.VENDOR) {
    console.warn(`Notice: Vendor record not found or invalid role for ID: ${vendorId}`);
    return;
  }

  // Retrieve subscription from Stripe to obtain accurate period end
  let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const stripeSubId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (stripeSubId) {
    try {
      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(stripeSubId);
      periodEnd = getSubscriptionPeriodEnd(subscription);
    } catch (subErr) {
      console.warn("Notice: Failed to retrieve subscription from Stripe:", subErr.message);
    }
  }

  // Update vendor subscription status in database
  await usersCollection.updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: periodEnd,
        stripeSubscriptionId: stripeSubId || null,
        updatedAt: new Date(),
      },
    }
  );

  // Idempotently record the transaction (duplicate key 11000 handled gracefully)
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
    if (txErr.code !== 11000) {
      console.warn("Notice: Transaction recording error:", txErr.message);
    }
  }
}

/**
 * POST /api/webhooks/stripe
 * Stripe webhook endpoint. Validates raw body with STRIPE_WEBHOOK_SECRET.
 * No Bearer token auth is used because Stripe invokes this directly.
 */
export async function handleStripeWebhook(req, res, next) {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
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
    return res.status(400).json({
      success: false,
      message: `Webhook signature verification failed: ${err.message}`,
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;

      default:
        // Acknowledge other events cleanly
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
