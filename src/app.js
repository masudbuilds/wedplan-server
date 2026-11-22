import express from "express";
import cors from "cors";
import helmet from "helmet";
import { notFound, errorHandler } from "./middleware/error.js";
import healthRoutes from "./routes/health.js";
import categoriesRoutes from "./routes/categories.js";

const app = express();

// Security headers
app.use(helmet());

// CORS configuration: allow only CLIENT_URL with credentials and Authorization header
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl) or matching clientUrl
      if (!origin || origin === clientUrl) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// JSON body parsing with raw body preserved for Stripe webhook verification later
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Mount public routes
app.use("/api/health", healthRoutes);
app.use("/api/categories", categoriesRoutes);

// Central 404 and Error handling middleware
app.use(notFound);
app.use(errorHandler);

export default app;
