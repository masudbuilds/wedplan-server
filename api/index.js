import app from "../src/app.js";
import { connectDB } from "../src/config/db.js";

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
