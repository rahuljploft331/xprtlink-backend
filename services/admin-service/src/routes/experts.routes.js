import { Router } from "express";
import { list, getById, setFeatured, update, setStatus, getTransactions, getSupportChats } from "#controllers/experts.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("experts", "view"), asyncHandler(list));
router.get("/:id", requirePermission("experts", "view"), asyncHandler(getById));
router.patch("/:id/featured", requirePermission("experts", "edit"), asyncHandler(setFeatured));
router.patch("/:id", requirePermission("experts", "edit"), asyncHandler(update));
router.patch("/:id/suspend", requirePermission("experts", "edit"), asyncHandler(setStatus));
router.patch("/:id/activate", requirePermission("experts", "edit"), asyncHandler(setStatus));
router.get("/:id/transactions", requirePermission("experts", "view"), asyncHandler(getTransactions));
router.get("/:id/support-chats", requirePermission("experts", "view"), asyncHandler(getSupportChats));
export default router;
