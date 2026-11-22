import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { getUsersCollection } from "../config/db.js";

// Cached JWKS instance so we do not recreate the set on every request
let jwks = null;

function getJWKS() {
  if (!jwks) {
    const jwksUrlString =
      process.env.BETTER_AUTH_JWKS_URL || "http://localhost:3000/api/auth/jwks";
    jwks = createRemoteJWKSet(new URL(jwksUrlString));
  }
  return jwks;
}

/**
 * Middleware: Verifies the JWT Bearer token using Better Auth's JWKS endpoint.
 * After verifying cryptographic integrity and expiry, it loads the user from
 * MongoDB to ensure the user exists, is not blocked, and gets the latest role/subscription.
 */
export async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token missing or malformed",
      });
    }

    const token = authHeader.split(" ")[1];
    const issuer = process.env.BETTER_AUTH_ISSUER || "http://localhost:3000";

    let payload;
    try {
      const verifyResult = await jwtVerify(token, getJWKS(), {
        issuer,
      });
      payload = verifyResult.payload;
    } catch (jwtErr) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    const userId = payload.sub;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Token has no valid subject identifier",
      });
    }

    // Better Auth can store user IDs either as a native ObjectId or as a string
    // depending on the database adapter configuration. We handle both so lookups never fail.
    const usersCollection = getUsersCollection();
    let user = null;

    if (ObjectId.isValid(userId)) {
      user = await usersCollection.findOne({
        $or: [
          { _id: new ObjectId(userId) },
          { _id: userId },
          { id: userId },
        ],
      });
    } else {
      user = await usersCollection.findOne({
        $or: [{ _id: userId }, { id: userId }],
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found in system records",
      });
    }

    // Blocked users are prohibited from accessing protected platform resources
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked. Please contact support.",
      });
    }

    // Attach verified user data from DB to request object
    req.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role || "customer",
      subscriptionPlan: user.subscriptionPlan || "free",
      subscriptionExpiresAt: user.subscriptionExpiresAt || null,
    };

    next();
  } catch (error) {
    next(error);
  }
}
