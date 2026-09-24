import { Router } from "express";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { listIssues, updateIssueStatus } from "../controllers/platformIssues.controller.js";

const router = Router();

// Assuming permission domain could be "supportTickets" for issues as well.
router.get("/", requirePermission("supportTickets", "view"), asyncHandler(listIssues));
router.patch("/:id/status", requirePermission("supportTickets", "edit"), asyncHandler(updateIssueStatus));

export default router;
