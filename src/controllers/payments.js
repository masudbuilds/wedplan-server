import { getStripe } from "../config/stripe.js";
import { isPremium } from "../utils/subscription.js";

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
