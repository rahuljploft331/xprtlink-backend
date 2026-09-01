import { Router } from "express";
import { getSettings, updateSettings, changePassword } from "#controllers/settings.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("settings", "view"), asyncHandler(getSettings));
router.patch("/", requirePermission("settings", "edit"), asyncHandler(updateSettings));
// Own-password change: any authenticated admin, no module permission — it only
// ever touches the caller's own account.
router.put("/password", asyncHandler(changePassword));
export default router;
