import { Router } from "express";
import { list, getById } from "#controllers/emailLogs.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
// Read-only: "view" on the email_logs module is all anyone needs (subadmins included).
router.use(requireAdmin, requirePermission("email_logs", "view"));
router.get("/", asyncHandler(list));
router.get("/:id", asyncHandler(getById));
export default router;
