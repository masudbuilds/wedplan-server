import Stripe from "stripe";

let stripeClient = null;

/**
 * Returns a cached singleton instance of the Stripe SDK.
 * Reads STRIPE_SECRET_KEY strictly from environment variables.
 */
export function getStripe() {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured in environment variables.");
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}
