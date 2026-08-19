import { Router } from "express";
import { list, getById } from "#controllers/subscriptions.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("subscriptions", "view"), asyncHandler(list));
router.get("/:id", requirePermission("subscriptions", "view"), asyncHandler(getById));
export default router;
