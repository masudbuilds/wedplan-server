import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import { createService } from "../controllers/vendor-services.js";

const router = Router();

// Protect all vendor service routes
router.use(verifyToken, requireRole(USER_ROLES.VENDOR));

// POST /api/vendor/services - create new service
router.post("/services", createService);

export default router;
