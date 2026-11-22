import express from "express";
import cors from "cors";
import helmet from "helmet";
import { notFound, errorHandler } from "./middleware/error.js";
import healthRoutes from "./routes/health.js";
import categoriesRoutes from "./routes/categories.js";
import servicesRoutes from "./routes/services.js";
import authRoutes from "./routes/auth.js";
import vendorServicesRoutes from "./routes/vendor-services.js";
import vendorBookingsRoutes from "./routes/vendor-bookings.js";
import bookingsRoutes from "./routes/bookings.js";
import statsRoutes from "./routes/stats.js";
import adminStatsRoutes from "./routes/admin-stats.js";
import adminUsersRoutes from "./routes/admin-users.js";
import adminServicesRoutes from "./routes/admin-services.js";
import adminTransactionsRoutes from "./routes/admin-transactions.js";
import webhooksRoutes from "./routes/webhooks.js";

const app = express();

// Security headers
app.use(helmet());

// CORS configuration: allow only CLIENT_URL with credentials and Authorization header
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Stripe, or curl) or matching clientUrl
      if (!origin || origin === clientUrl) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// 1. Stripe webhook route mounted BEFORE express.json() with raw body parsing
app.use(
  "/api/webhooks",
  express.raw({ type: "application/json" }),
  webhooksRoutes
);

// 2. General JSON body parsing for all other routes
app.use(express.json());

// Mount public routes
app.use("/api/health", healthRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/services", servicesRoutes);

// Mount auth routes (protected)
app.use("/api", authRoutes);

// Mount stats routes (vendor & customer dashboards)
app.use("/api", statsRoutes);

// Mount vendor routes (protected)
app.use("/api/vendor", vendorServicesRoutes);
app.use("/api/vendor", vendorBookingsRoutes);

// Mount booking routes (protected)
app.use("/api/bookings", bookingsRoutes);

// Mount admin routes (protected)
app.use("/api/admin", adminStatsRoutes);
app.use("/api/admin", adminUsersRoutes);
app.use("/api/admin", adminServicesRoutes);
app.use("/api/admin", adminTransactionsRoutes);

// Central 404 and Error handling middleware
app.use(notFound);
app.use(errorHandler);

export default app;
