import { Router } from "express";
import { list, getById, update, setStatus, getTransactions, getSupportChats } from "#controllers/customers.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("customers", "view"), asyncHandler(list));
router.get("/:id", requirePermission("customers", "view"), asyncHandler(getById));
router.patch("/:id", requirePermission("customers", "edit"), asyncHandler(update));
router.patch("/:id/suspend", requirePermission("customers", "edit"), asyncHandler(setStatus));
router.patch("/:id/activate", requirePermission("customers", "edit"), asyncHandler(setStatus));
router.get("/:id/transactions", requirePermission("customers", "view"), asyncHandler(getTransactions));
router.get("/:id/support-chats", requirePermission("customers", "view"), asyncHandler(getSupportChats));
export default router;
