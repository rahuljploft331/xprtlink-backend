import { Router } from "express";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { requirePermission } from "@xprtlink/shared/middleware/auth.js";
import { listIssues, updateIssueStatus } from "../controllers/platformIssues.controller.js";

const router = Router();

// Assuming permission domain could be "supportTickets" for issues as well.
router.get("/", requirePermission("supportTickets", "view"), asyncHandler(listIssues));
router.patch("/:id/status", requirePermission("supportTickets", "edit"), asyncHandler(updateIssueStatus));

export default router;
