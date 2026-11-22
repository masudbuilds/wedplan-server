import { Router } from "express";
import { getServices } from "../controllers/services.js";

const router = Router();

// GET /api/services - search, filter, sort, and paginate approved & active services
router.get("/", getServices);

export default router;
