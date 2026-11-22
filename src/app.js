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

// Central 404 and Error handling middleware
app.use(notFound);
app.use(errorHandler);

export default app;
