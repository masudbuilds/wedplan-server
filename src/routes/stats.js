import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import {
  getVendorStats,
  getCustomerStats,
} from "../controllers/stats.js";

const router = Router();

// GET /api/vendor/stats - vendor dashboard statistics
router.get(
  "/vendor/stats",
  verifyToken,
  requireRole(USER_ROLES.VENDOR),
  getVendorStats
);

// GET /api/customer/stats - customer dashboard statistics
router.get(
  "/customer/stats",
  verifyToken,
  requireRole(USER_ROLES.CUSTOMER),
  getCustomerStats
);

export default router;
