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
 * Helper to find a vendor by vendorId or stripeSubscriptionId
 */
async function findVendorForSubscription(vendorId, stripeSubId) {
  const usersCollection = getUsersCollection();

  if (vendorId) {
    console.log(`[Stripe Webhook] Looking up vendor by ID: ${vendorId}`);
    const byId = await usersCollection.findOne({
      $or: [
        { _id: vendorId },
        { id: vendorId },
        ...(ObjectId.isValid(vendorId) ? [{ _id: new ObjectId(vendorId) }] : []),
      ],
    });
    if (byId) {
      console.log(
        `[Stripe Webhook] Vendor found by ID: ${vendorId} (name="${byId.name}", email="${byId.email}", role="${byId.role}")`
      );
      return byId;
    }
    console.log(`[Stripe Webhook] No vendor found with ID: ${vendorId}`);
  }

  if (stripeSubId) {
    console.log(`[Stripe Webhook] Looking up vendor by stripeSubscriptionId: ${stripeSubId}`);
    const bySub = await usersCollection.findOne({
      stripeSubscriptionId: stripeSubId,
    });
    if (bySub) {
      console.log(
        `[Stripe Webhook] Vendor found by stripeSubscriptionId: ${stripeSubId} (name="${bySub.name}", email="${bySub.email}", role="${bySub.role}")`
      );
      return bySub;
    }
    console.log(`[Stripe Webhook] No vendor found with stripeSubscriptionId: ${stripeSubId}`);
  }

  return null;
}

/**
 * 1. Handles checkout.session.completed
 * Activates vendor Premium plan and idempotently creates a completed transaction.
 */
async function handleCheckoutSessionCompleted(session) {
  console.log(`[Stripe Webhook] Step 1: Handling checkout.session.completed for session: ${session.id}`);

  const isPaid =
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required";
  const isComplete = session.status === "complete";

  if (!isPaid && !isComplete) {
    console.log(
      `[Stripe Webhook] Early return: Session ${session.id} not paid/complete (payment_status="${session.payment_status}", status="${session.status}")`
    );
    return;
  }

  const vendorId = session.metadata?.vendorId || session.client_reference_id;
  const stripeSubId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  console.log(`[Stripe Webhook] Step 2: Extracted vendorId="${vendorId}", stripeSubId="${stripeSubId}"`);

  const vendor = await findVendorForSubscription(vendorId, stripeSubId);
  if (!vendor) {
    console.error(
      `[Stripe Webhook] Early return: Vendor not found in DB for session ${session.id} (vendorId: ${vendorId}, stripeSubId: ${stripeSubId})`
    );
    return;
  }

  console.log(`[Stripe Webhook] Step 3: Determining subscription period end date`);
  let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (stripeSubId) {
    try {
      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(stripeSubId);
      periodEnd = getSubscriptionPeriodEnd(subscription);
      console.log(
        `[Stripe Webhook] Retrieved Stripe subscription ${stripeSubId}, periodEnd=${periodEnd.toISOString()}`
      );
    } catch (subErr) {
      console.warn(
        `[Stripe Webhook] Warning: Could not retrieve subscription ${stripeSubId} (${subErr.message}). Using 30-day fallback.`
      );
    }
  }

  const usersCollection = getUsersCollection();
  const transactionsCollection = getTransactionsCollection();

  console.log(`[Stripe Webhook] Step 4: Updating vendor ${vendor._id} subscriptionPlan to "premium"`);
  const updateResult = await usersCollection.updateOne(
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
  console.log(
    `[Stripe Webhook] Vendor update complete: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`
  );

  console.log(`[Stripe Webhook] Step 5: Recording transaction in database`);
  try {
    const existing = await transactionsCollection.findOne({
      stripeSessionId: session.id,
    });

    if (!existing) {
      const txResult = await transactionsCollection.insertOne({
        vendorId: vendor._id.toString(),
        plan: "premium",
        amount: (session.amount_total || 0) / 100,
        currency: session.currency || "usd",
        stripeSessionId: session.id,
        stripeSubscriptionId: stripeSubId || null,
        status: TRANSACTION_STATUS.COMPLETED,
        createdAt: new Date(),
      });
      console.log(`[Stripe Webhook] Transaction inserted successfully with ID: ${txResult.insertedId}`);
    } else {
      console.log(
        `[Stripe Webhook] Transaction already recorded for session ${session.id} (ID: ${existing._id})`
      );
    }
  } catch (txErr) {
    // Gracefully handle duplicate key race condition
    if (txErr.code !== 11000) {
      console.error(`[Stripe Webhook] Error recording transaction: ${txErr.message}`);
      throw txErr;
    }
    console.log(`[Stripe Webhook] Duplicate transaction ignored for session ${session.id}`);
  }
}

/**
 * 2. Handles invoice.paid (subscription renewals)
 * Extends subscription period and records renewal transaction.
 */
async function handleInvoicePaid(invoice) {
  console.log(`[Stripe Webhook] Handling invoice.paid for invoice: ${invoice.id}`);
  const stripeSubId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;

  if (!stripeSubId) {
    console.log(`[Stripe Webhook] Early return: invoice ${invoice.id} has no subscription ID`);
    return;
  }

  const vendorId =
    invoice.subscription_details?.metadata?.vendorId ||
    invoice.metadata?.vendorId;

  console.log(`[Stripe Webhook] invoice.paid: vendorId="${vendorId}", stripeSubId="${stripeSubId}"`);
  const vendor = await findVendorForSubscription(vendorId, stripeSubId);
  if (!vendor) {
    console.error(`[Stripe Webhook] invoice.paid: Vendor not found for invoice ${invoice.id}`);
    return;
  }

  let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(stripeSubId);
    periodEnd = getSubscriptionPeriodEnd(subscription);
  } catch (subErr) {
    console.warn(`[Stripe Webhook] Warning: Failed to retrieve sub ${stripeSubId} on invoice.paid: ${subErr.message}`);
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
  console.log(`[Stripe Webhook] Renewed subscription for vendor ${vendor._id} until ${periodEnd.toISOString()}`);

  try {
    const existing = await transactionsCollection.findOne({
      stripeInvoiceId: invoice.id,
    });

    if (!existing) {
      const txResult = await transactionsCollection.insertOne({
        vendorId: vendor._id.toString(),
        plan: "premium",
        amount: (invoice.amount_paid || 0) / 100,
        currency: invoice.currency || "usd",
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: stripeSubId,
        status: TRANSACTION_STATUS.COMPLETED,
        createdAt: new Date(),
      });
      console.log(`[Stripe Webhook] Renewal transaction recorded with ID: ${txResult.insertedId}`);
    } else {
      console.log(`[Stripe Webhook] Invoice transaction already recorded for ${invoice.id}`);
    }
  } catch (txErr) {
    if (txErr.code !== 11000) {
      throw txErr;
    }
  }
}

/**
 * 3. Handles invoice.payment_failed
 * Records a failed transaction record without extending subscription.
 */
async function handleInvoicePaymentFailed(invoice) {
  console.log(`[Stripe Webhook] Handling invoice.payment_failed for invoice: ${invoice.id}`);
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
      console.log(`[Stripe Webhook] Recorded failed invoice transaction for vendor ${vendor._id}`);
    }
  } catch (txErr) {
    if (txErr.code !== 11000) {
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
  console.log(`[Stripe Webhook] Handling customer.subscription.deleted for sub: ${subscription.id}`);
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
  console.log(`[Stripe Webhook] Downgraded vendor ${vendor._id} to free plan`);

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
    console.log(
      `[Stripe Webhook] Deactivated ${idsToDeactivate.length} excess services for vendor ${vendor._id}`
    );
  }
}

/**
 * 5. Handles customer.subscription.updated
 * Synchronizes cancel_at_period_end or current_period_end changes.
 */
async function handleSubscriptionUpdated(subscription) {
  console.log(`[Stripe Webhook] Handling customer.subscription.updated for sub: ${subscription.id}`);
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
  console.log(
    `[Stripe Webhook] Updated subscription status for vendor ${vendor._id} (cancelAtPeriodEnd=${Boolean(subscription.cancel_at_period_end)})`
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
    console.error("[Stripe Webhook] Missing stripe-signature header or STRIPE_WEBHOOK_SECRET env var.");
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
    console.error(`[Stripe Webhook] Webhook signature verification failed: ${err.message}`);
    return res.status(400).json({
      success: false,
      message: `Webhook signature verification failed: ${err.message}`,
    });
  }

  console.log(`[Stripe Webhook] Received verified event: "${event.type}" (ID: ${event.id})`);

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
        console.log(`[Stripe Webhook] Ignored unhandled event type: "${event.type}"`);
        break;
    }

    console.log(`[Stripe Webhook] Successfully processed event: "${event.type}" (ID: ${event.id})`);
    res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[Stripe Webhook] Error processing event "${event.type}":`, err.message);
    res.status(500).json({
      success: false,
      message: `Webhook handler failed: ${err.message}`,
    });
  }
}
