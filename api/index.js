import app from "../src/app.js";
import { connectDB } from "../src/config/db.js";

/**
 * Tell Vercel NOT to parse request bodies so express.raw({ type: "application/json" })
 * can receive the raw unparsed Buffer stream required for Stripe signature verification.
 */
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Serverless entry point for Vercel deployment.
 * Ensures the cached MongoDB connection is initialized before handling the request.
 */
export default async function handler(req, res) {
  try {
    await connectDB();
  } catch (err) {
    console.error("Serverless DB connection error:", err.message);
  }
  return app(req, res);
}
