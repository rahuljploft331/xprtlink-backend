import { Router } from "express";
import { stream, status } from "#controllers/events.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";

const router = Router();

// All SSE connections require a valid admin JWT.
router.use(requireAdmin);

/**
 * GET /api/v1/admin/events
 * Opens the SSE stream. Keep connection alive to receive real-time events.
 *
 * Events pushed by the server:
 *   ticket:created          – { id, subject, category, userId, createdAt }
 *   verification:submitted  – { id, expertId, expertName, submittedAt }
 *   report:filed            – { id, expertId, customerId, reason, createdAt }
 *   consultation:completed  – { id, expertId, customerId, durationSeconds, billingStatus }
 *   user:registered         – { id, role, email, createdAt }
 *   review:flagged          – { id, expertId, customerId, rating, createdAt }
 */
router.get("/", stream);

/**
 * GET /api/v1/admin/events/status
 * Returns the current connected SSE client count (debug / monitoring).
 */
router.get("/status", status);

export default router;
