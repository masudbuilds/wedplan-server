import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import { createCheckoutSession } from "../controllers/payments.js";

const router = Router();

// Protect all payment endpoints for vendors
router.use(verifyToken, requireRole(USER_ROLES.VENDOR));

// POST /api/payments/create-checkout-session
router.post("/create-checkout-session", createCheckoutSession);

export default router;
