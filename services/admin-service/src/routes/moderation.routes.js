import { Router } from "express";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { listExpertReports, updateExpertReport, listConversationReports, deleteConversationReport } from "#controllers/moderation.controller.js";

const router = Router();
router.use(requireAdmin);

router.get("/expert-reports", requirePermission("experts", "view"), asyncHandler(listExpertReports));
router.patch("/expert-reports/:id", requirePermission("experts", "edit"), asyncHandler(updateExpertReport));

router.get("/conversation-reports", requirePermission("experts", "view"), asyncHandler(listConversationReports));
router.delete("/conversation-reports/:id", requirePermission("experts", "edit"), asyncHandler(deleteConversationReport));

export default router;
