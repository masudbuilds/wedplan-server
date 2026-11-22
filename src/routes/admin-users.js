import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import {
  getAdminUsers,
  getAdminUserById,
} from "../controllers/admin-users.js";

const router = Router();

// Protect all admin user routes
router.use(verifyToken, requireRole(USER_ROLES.ADMIN));

// GET /api/admin/users - list users with search, role filter, pagination
router.get("/users", getAdminUsers);

// GET /api/admin/users/:id - get single user details with stats
router.get("/users/:id", getAdminUserById);

export default router;
