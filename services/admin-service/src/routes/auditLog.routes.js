import { Router } from "express";
import { list } from "#controllers/auditLog.controller.js";
import { requireAdmin, requireSuperAdmin } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
// Read-only trail — super admins only; the audit log is intentionally not an
// ADMIN_MODULES entry, so there is no per-subadmin permission row to grant.
router.use(requireAdmin, requireSuperAdmin);
router.get("/", asyncHandler(list));
export default router;
