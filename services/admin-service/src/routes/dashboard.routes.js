import { Router } from "express";
import { getStats } from "#controllers/dashboard.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();

router.use(requireAdmin);

/** GET /api/dashboard/stats */
router.get("/stats", requirePermission("dashboard", "view"), asyncHandler(getStats));

export default router;
