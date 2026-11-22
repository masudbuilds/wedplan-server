import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import { createBooking } from "../controllers/bookings.js";

const router = Router();

// Protect customer booking creation
router.post("/", verifyToken, requireRole(USER_ROLES.CUSTOMER), createBooking);

export default router;
