import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import { validateObjectIdParam } from "../utils/object-id.js";
import {
  getVendorBookings,
  updateVendorBookingStatus,
} from "../controllers/vendor-bookings.js";

const router = Router();

// Protect all vendor booking routes
router.use(verifyToken, requireRole(USER_ROLES.VENDOR));

// GET /api/vendor/bookings - list bookings for this vendor's services
router.get("/bookings", getVendorBookings);

// PATCH /api/vendor/bookings/:id/status - accept or reject a pending booking
router.patch(
  "/bookings/:id/status",
  validateObjectIdParam("id"),
  updateVendorBookingStatus
);

export default router;
