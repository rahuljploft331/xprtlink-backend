import { Router } from "express";
import { globalSearch } from "#controllers/search.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);

// Global search fans out across customers, experts, categories, consultations,
// quotes, and admins — gate it on the dashboard module (the general landing/
// overview permission most roles carry) rather than any single domain module.
/** GET /api/v1/admin/search?q=... */
router.get("/", requirePermission("dashboard", "view"), asyncHandler(globalSearch));

export default router;
