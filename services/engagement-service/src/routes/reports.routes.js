import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { expertReportRequestSchema } from "@xprtlink/shared/contracts/index.js";
import * as svc from "../services/engagementService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { getDb } from "@xprtlink/shared/db";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { REPORT_REASONS, createConversationReport } from "@xprtlink/shared/utils/reportReasons.js";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await svc.getMyReports(req.auth);
    return ResponseFormatter.success(res, {
      message: getMessage("reportsFetched"),
      data,
      status: 200,
    });
  })
);

router.get("/reasons", (req, res) => {
  return ResponseFormatter.success(res, {
    message: "Report reasons fetched successfully",
    data: REPORT_REASONS,
    status: 200,
  });
});

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
    const { conversationId, reason, details } = req.body;
    if (!conversationId || !reason) {
      throw badRequest("missingRequiredFields");
    }

    const { role, customerProfileId, expertProfileId } = req.auth;
    const ownerWhere =
      role === "customer"
        ? { customerId: customerProfileId }
        : role === "expert"
          ? { expertId: expertProfileId }
          : null;
    if (!ownerWhere) throw notFound("conversationNotFound");

    const db = getDb();
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, ...ownerWhere },
    });
    if (!conversation) throw notFound("conversationNotFound");

    const report = await createConversationReport(db, req.auth, conversation, { reason, details });
    return ResponseFormatter.success(res, {
      message: getMessage("conversationReported"),
      data: { id: report.id },
      status: 201,
    });
  })
);

export default router;
