import { Router } from "express";
import { handleStripeWebhook } from "../controllers/webhooks.js";

const router = Router();

// POST /api/webhooks/stripe - Stripe webhook listener
router.post("/stripe", handleStripeWebhook);

export default router;
