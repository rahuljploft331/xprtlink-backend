import { Router } from "express";
import { getStats } from "#controllers/dashboard.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";

const router = Router();

router.use(requireAdmin);

/** GET /api/dashboard/stats */
router.get("/stats", getStats);

export default router;
