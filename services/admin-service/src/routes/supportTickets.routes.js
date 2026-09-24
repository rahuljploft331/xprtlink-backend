import { Router } from "express";
import { list, getById, reply } from "#controllers/supportTickets.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);

router.get("/", requirePermission("support_tickets", "view"), asyncHandler(list));
router.get("/:id", requirePermission("support_tickets", "view"), asyncHandler(getById));
router.post("/:id/reply", requirePermission("support_tickets", "edit"), asyncHandler(reply));

export default router;
