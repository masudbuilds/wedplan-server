import { getStripe } from "../config/stripe.js";

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
    // Event handlers will be dispatched here
    switch (event.type) {
      default:
        // Acknowledge unknown events quietly
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
