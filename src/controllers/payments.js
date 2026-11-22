import { ObjectId } from "mongodb";
import { getStripe } from "../config/stripe.js";
import { getUsersCollection, getTransactionsCollection } from "../config/db.js";
import { isPremium } from "../utils/subscription.js";
import { getSubscriptionPeriodEnd } from "./webhooks.js";

/**
 * POST /api/payments/create-checkout-session
 * Role: vendor
 * Creates a Stripe Checkout Session in subscription mode.
 * Enforces:
 * - Current vendor ID is taken strictly from req.user.id (never client body).
 * - Rejects already-premium vendors with 409 Conflict.
 * - Attaches vendorId to metadata and subscription_data.metadata.
 */
export async function createCheckoutSession(req, res, next) {
  try {
    // Prevent duplicate active subscriptions
    if (isPremium(req.user)) {
      return res.status(409).json({
        success: false,
        message: "You already have an active Premium subscription.",
      });
    }

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      return res.status(500).json({
        success: false,
        message: "STRIPE_PRICE_ID is not configured on the server.",
      });
    }

    const stripe = getStripe();
    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: req.user.email,
      client_reference_id: req.user.id,
      metadata: {
        vendorId: req.user.id,
      },
      subscription_data: {
        metadata: {
          vendorId: req.user.id,
        },
      },
      success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/payment/cancel`,
    });

    res.json({
      success: true,
      url: session.url,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/payments/session-status?session_id=...
 * Role: vendor
 * Checks Checkout Session status for the Payment Success page.
 * Strictly READ-ONLY: never activates premium access itself.
 * Reports whether the database webhook processor has activated premium.
 */
export async function getSessionStatus(req, res, next) {
  try {
    const { session_id } = req.query;
    if (!session_id || typeof session_id !== "string" || !session_id.trim()) {
      return res.status(400).json({
        success: false,
        message: "Query parameter 'session_id' is required.",
      });
    }

    const stripe = getStripe();
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(session_id.trim());
    } catch (stripeErr) {
      return res.status(404).json({
        success: false,
        message: "Stripe Checkout session not found.",
      });
    }

    // Ownership check: must belong to the authenticated vendor
    const sessionVendorId =
      session.metadata?.vendorId || session.client_reference_id;

    if (sessionVendorId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to view this checkout session.",
      });
    }

    // Query latest status directly from MongoDB (populated only by verified webhooks)
    const usersCollection = getUsersCollection();
    const currentUser = await usersCollection.findOne({
      $or: [
        { _id: req.user.id },
        { id: req.user.id },
        ...(ObjectId.isValid(req.user.id) ? [{ _id: new ObjectId(req.user.id) }] : []),
      ],
    });

    res.json({
      success: true,
      paymentStatus: session.payment_status,
      isPremium: isPremium(currentUser),
      subscriptionExpiresAt: currentUser?.subscriptionExpiresAt || null,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/payments/cancel-subscription
 * Role: vendor
 * Schedules subscription cancellation at the end of the billing period.
 * Premium status remains active until the expiration date.
 */
export async function cancelSubscription(req, res, next) {
  try {
    const usersCollection = getUsersCollection();
    const vendor = await usersCollection.findOne({
      $or: [
        { _id: req.user.id },
        { id: req.user.id },
        ...(ObjectId.isValid(req.user.id) ? [{ _id: new ObjectId(req.user.id) }] : []),
      ],
    });

    if (!vendor || !isPremium(vendor)) {
      return res.status(404).json({
        success: false,
        message: "No active Premium subscription found to cancel.",
      });
    }

    const transactionsCollection = getTransactionsCollection();
    let stripeSubId = vendor.stripeSubscriptionId;

    if (!stripeSubId) {
      const latestTx = await transactionsCollection.findOne(
        { vendorId: req.user.id, stripeSubscriptionId: { $ne: null } },
        { sort: { createdAt: -1 } }
      );
      stripeSubId = latestTx?.stripeSubscriptionId;
    }

    if (!stripeSubId) {
      return res.status(404).json({
        success: false,
        message: "Active subscription identifier not found in records.",
      });
    }

    const stripe = getStripe();
    const updatedSub = await stripe.subscriptions.update(stripeSubId, {
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
      message: "Subscription scheduled to cancel at the end of the current billing period. Premium access remains active until expiration.",
      subscriptionExpiresAt: periodEnd,
      cancelAtPeriodEnd: true,
    });
  } catch (error) {
    next(error);
  }
}
