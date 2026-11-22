import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import { validateObjectIdParam } from "../utils/object-id.js";
import {
  getAdminServices,
  getAdminServiceById,
} from "../controllers/admin-services.js";

const router = Router();

// Protect all admin service routes
router.use(verifyToken, requireRole(USER_ROLES.ADMIN));

// GET /api/admin/services - list all services with filters & pagination
router.get("/services", getAdminServices);

// GET /api/admin/services/:id - get service details with vendor info
router.get("/services/:id", validateObjectIdParam("id"), getAdminServiceById);

export default router;
