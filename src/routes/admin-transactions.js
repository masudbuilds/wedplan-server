import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import { getAdminTransactions } from "../controllers/admin-transactions.js";

/**
 * ARCHITECTURE SECURITY NOTICE:
 * Platform payment transactions are strictly READ-ONLY for Admins.
 * NO POST, PUT, PATCH, or DELETE endpoints exist or will ever be added for transactions.
 * Per the assignment specification:
 * "Admin must not be able to modify payment records manually to mark an unsuccessful payment as successful."
 */

const router = Router();

// Protect all admin transaction routes
router.use(verifyToken, requireRole(USER_ROLES.ADMIN));

// GET /api/admin/transactions - list platform transactions (READ ONLY)
router.get("/transactions", getAdminTransactions);

export default router;
