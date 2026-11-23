import Stripe from "stripe";

let stripeClient = null;

/**
 * Returns a cached singleton instance of the Stripe SDK.
 * Initialized lazily on demand so module loading never crashes if env is unset at import time.
 */
export function getStripe() {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || typeof key !== "string" || !key.trim()) {
      throw new Error("STRIPE_SECRET_KEY is not configured in environment variables.");
    }
    stripeClient = new Stripe(key.trim());
  }
  return stripeClient;
}
