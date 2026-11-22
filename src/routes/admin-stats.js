import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import { getAdminStats } from "../controllers/admin-stats.js";

const router = Router();

// Protect all admin stats routes
router.use(verifyToken, requireRole(USER_ROLES.ADMIN));

// GET /api/admin/stats - platform overview metrics
router.get("/stats", getAdminStats);

export default router;
