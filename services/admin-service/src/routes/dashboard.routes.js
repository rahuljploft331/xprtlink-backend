import { Router } from "express";
import { getStats, getTrends, getLowRatingAlerts } from "#controllers/dashboard.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();

router.use(requireAdmin);

/** GET /api/dashboard/stats */
router.get("/stats", requirePermission("dashboard", "view"), asyncHandler(getStats));
router.get("/trends", requirePermission("dashboard", "view"), asyncHandler(getTrends));
router.get("/low-rating-alerts", requirePermission("dashboard", "view"), asyncHandler(getLowRatingAlerts));

export default router;
