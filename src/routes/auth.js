import { Router } from "express";
import { getCurrentUser } from "../controllers/auth.js";
import { verifyToken } from "../middleware/auth.js";

const router = Router();

// GET /api/me - returns safe profile info of currently logged-in user
router.get("/me", verifyToken, getCurrentUser);

export default router;
