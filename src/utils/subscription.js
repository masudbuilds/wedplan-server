/**
 * Helper to determine if a user has an active Premium subscription.
 * A user is premium ONLY when:
 * 1. subscriptionPlan is "premium"
 * 2. subscriptionExpiresAt exists, is valid, and is in the future.
 * Expired premium accounts count as free tier.
 */
export function isPremium(user) {
  if (!user || user.subscriptionPlan !== "premium") {
    return false;
  }

  if (!user.subscriptionExpiresAt) {
    return false;
  }

  const expiry = new Date(user.subscriptionExpiresAt);
  return !isNaN(expiry.getTime()) && expiry.getTime() > Date.now();
}
