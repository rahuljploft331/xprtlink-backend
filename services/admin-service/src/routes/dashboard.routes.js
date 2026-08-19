import { Router } from "express";
import { getStats } from "#controllers/dashboard.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";

const router = Router();

router.use(requireAdmin);

/** GET /api/dashboard/stats */
router.get("/stats", requirePermission("dashboard", "view"), getStats);

export default router;
