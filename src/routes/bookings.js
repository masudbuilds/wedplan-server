import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import { validateObjectIdParam } from "../utils/object-id.js";
import {
  createBooking,
  getMyBookings,
  getBookingById,
  cancelBooking,
} from "../controllers/bookings.js";

const router = Router();

// All booking routes require authentication
router.use(verifyToken);

// POST /api/bookings - customer creates a booking
router.post("/", requireRole(USER_ROLES.CUSTOMER), createBooking);

// GET /api/bookings/my - customer views their booking list (must be defined BEFORE /:id)
router.get("/my", requireRole(USER_ROLES.CUSTOMER), getMyBookings);

// GET /api/bookings/:id - customer owner or vendor owner views booking details
router.get("/:id", validateObjectIdParam("id"), getBookingById);

// PATCH /api/bookings/:id/cancel - customer cancels pending booking
router.patch(
  "/:id/cancel",
  requireRole(USER_ROLES.CUSTOMER),
  validateObjectIdParam("id"),
  cancelBooking
);

export default router;
