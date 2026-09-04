import { Router } from "express";
import { getSummary, exportReport } from "#controllers/reports.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();

router.use(requireAdmin);

/** GET /api/v1/admin/reports/summary */
router.get("/summary", requirePermission("reports", "view"), asyncHandler(getSummary));

/** GET /api/v1/admin/reports/:reportId/export */
router.get("/:reportId/export", requirePermission("reports", "view"), asyncHandler(exportReport));

export default router;
