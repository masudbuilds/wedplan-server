import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import {
  getAdminUsers,
  getAdminUserById,
  blockUser,
  unblockUser,
} from "../controllers/admin-users.js";

const router = Router();

// Protect all admin user routes
router.use(verifyToken, requireRole(USER_ROLES.ADMIN));

// GET /api/admin/users - list users with search, role filter, pagination
router.get("/users", getAdminUsers);

// GET /api/admin/users/:id - get single user details with stats
router.get("/users/:id", getAdminUserById);

// PATCH /api/admin/users/:id/block - block user and revoke active sessions
router.patch("/users/:id/block", blockUser);

// PATCH /api/admin/users/:id/unblock - unblock user
router.patch("/users/:id/unblock", unblockUser);

export default router;
