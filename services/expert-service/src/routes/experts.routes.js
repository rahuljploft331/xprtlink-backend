import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate, optionalAuthenticate, requireRole } from "@xprtlink/shared/middleware/auth.js";
import { expertMeUpdateRequestSchema, expertOnboardingRequestSchema, expertSettingsUpdateRequestSchema, expertVerificationDocumentsRequestSchema } from "@xprtlink/shared/contracts";
import * as svc from "../services/expertService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";


const router = Router();

router.get(
  "/featured",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const { limit } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });
    const data = await svc.getFeatured(limit);
    return ResponseFormatter.success(res, { message: getMessage("featuredExperts"), data });
  })
);

router.get(
  "/trending",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const { limit } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });
    const data = await svc.getTrending(limit);
    return ResponseFormatter.success(res, { message: getMessage("trendingExperts"), data });
  })
);

router.get(
  "/me",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getExpertMe(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("expertProfile"), data });
  })
);

router.patch(
  "/me",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const body = expertMeUpdateRequestSchema.parse(req.body);
    const data = await svc.updateExpertMe(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("expertProfileUpdated"), data });
  })
);

router.post(
  "/me/onboarding/submit",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const body = expertOnboardingRequestSchema.parse(req.body);
    const data = await svc.submitOnboarding(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("onboardingSubmitted"), data });
  })
);

router.get(
  "/me/verification",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getVerification(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("verificationStatus"), data });
  })
);

router.post(
  "/me/verification/documents",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const body = expertVerificationDocumentsRequestSchema.parse(req.body);
    const data = await svc.submitVerificationDocuments(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("documentsSubmitted"), data });
  })
);

router.get(
  "/me/dashboard",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getDashboard(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("dashboard"), data });
  })
);

router.get(
  "/me/rating-summary",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getRatingSummary(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("ratingSummary"), data });
  })
);

router.get(
  "/me/reviews",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getMyReviews(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("reviews"), ...data });
  })
);

router.get(
  "/me/settings",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getSettings(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("settings"), data });
  })
);

router.patch(
  "/me/settings",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const body = expertSettingsUpdateRequestSchema.parse(req.body);
    const data = await svc.updateSettings(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("settingsUpdated"), data });
  })
);

router.get(
  "/:id/reviews",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getExpertReviews(req.params.id, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("expertReviews"), ...data });
  })
);

router.get(
  "/:id/availability",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getExpertAvailability(req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("availability"), data });
  })
);

router.get(
  "/:id",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getExpertById(req.params.id, req.auth);
    return ResponseFormatter.success(res, { message: getMessage("expertProfile"), data });
  })
);

export default router;
