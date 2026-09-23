import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { expertReportRequestSchema } from "@xprtlink/shared/contracts/index.js";
import * as svc from "../services/engagementService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { getDb } from "@xprtlink/shared/db/prisma.js";

const router = Router();

router.use(authenticate);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = expertReportRequestSchema.parse(req.body);
    const data = await svc.createReport(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("reportSubmitted"), data, status: 201 });
  })
);

router.post(
  "/conversations",
  asyncHandler(async (req, res) => {
    const { conversationId, reason } = req.body;
    if (!conversationId || !reason) {
      return res.status(400).json({ success: false, message: "conversationId and reason are required" });
    }

    const db = getDb();
    
    // Check if conversation exists
    const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const report = await db.conversationReport.create({
      data: {
        conversationId,
        reporterUserId: req.auth.id,
        reason: reason.substring(0, 500),
      },
    });

    return ResponseFormatter.success(res, { message: "Conversation reported successfully", data: report, status: 201 });
  })
);

export default router;
