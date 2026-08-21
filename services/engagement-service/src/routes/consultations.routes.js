import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import {
  createConsultationRequestSchema,
  submitReviewRequestSchema,
} from "@xprtlink/shared/contracts";
import * as svc from "../services/engagementService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

router.use(authenticate);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createConsultationRequestSchema.parse(req.body);
    const data = await svc.createConsultation(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("consultationRequested"), data, status: 201 });
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await svc.listConsultations(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("consultationsLoaded"), ...data });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = await svc.getConsultation(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("consultationLoaded"), data });
  })
);

router.post(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const data = await svc.acceptConsultation(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("consultationAccepted"), data });
  })
);

router.post(
  "/:id/decline",
  asyncHandler(async (req, res) => {
    const data = await svc.declineConsultation(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("consultationDeclined"), data });
  })
);

router.post(
  "/:id/end",
  asyncHandler(async (req, res) => {
    const data = await svc.endConsultation(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("consultationEnded"), data });
  })
);

router.get(
  "/:id/video-token",
  asyncHandler(async (req, res) => {
    const data = await svc.getVideoToken(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("videoTokenIssued"), data });
  })
);

router.get(
  "/:id/billing-summary",
  asyncHandler(async (req, res) => {
    const data = await svc.getBillingSummary(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("billingSummaryLoaded"), data });
  })
);

router.post(
  "/:id/review",
  asyncHandler(async (req, res) => {
    const body = submitReviewRequestSchema.parse(req.body);
    const data = await svc.submitReview(req.auth, req.params.id, body);
    return ResponseFormatter.success(res, { message: getMessage("reviewSubmitted"), data, status: 201 });
  })
);

export default router;
