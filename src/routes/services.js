import { Router } from "express";
import {
  getServices,
  getFeaturedServices,
  getServiceById,
} from "../controllers/services.js";
import { validateObjectIdParam } from "../utils/object-id.js";

const router = Router();

// GET /api/services - list with search, filter, sort, pagination
router.get("/", getServices);

// GET /api/services/featured - 6 latest approved & active services (MUST be defined before /:id)
router.get("/featured", getFeaturedServices);

// GET /api/services/:id - service detail with vendor information
router.get("/:id", validateObjectIdParam("id"), getServiceById);

export default router;
