import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth.js";
import { USER_ROLES } from "../utils/constants.js";
import { validateObjectIdParam } from "../utils/object-id.js";
import {
  createService,
  getMyServices,
  getMyServiceById,
  updateService,
  deleteService,
} from "../controllers/vendor-services.js";

const router = Router();

// Protect all vendor service routes
router.use(verifyToken, requireRole(USER_ROLES.VENDOR));

// POST /api/vendor/services - create new service
router.post("/services", createService);

// GET /api/vendor/services - list own services
router.get("/services", getMyServices);

// GET /api/vendor/services/:id - get own service by ID
router.get("/services/:id", validateObjectIdParam("id"), getMyServiceById);

// PATCH /api/vendor/services/:id - update own service
router.patch("/services/:id", validateObjectIdParam("id"), updateService);

// DELETE /api/vendor/services/:id - delete own service
router.delete("/services/:id", validateObjectIdParam("id"), deleteService);

export default router;
