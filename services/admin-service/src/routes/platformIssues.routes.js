import { Router } from "express";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { listIssues, updateIssueStatus } from "../controllers/platformIssues.controller.js";

const router = Router();
router.use(requireAdmin);

// Assuming permission domain could be "support_tickets" for issues as well.
router.get("/", requirePermission("support_tickets", "view"), asyncHandler(listIssues));
router.patch("/:id/status", requirePermission("support_tickets", "edit"), asyncHandler(updateIssueStatus));

export default router;
