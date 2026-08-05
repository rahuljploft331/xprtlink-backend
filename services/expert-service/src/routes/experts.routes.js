import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate, optionalAuthenticate, requireRole } from "@xprtlink/shared/middleware/auth.js";
import { expertMeUpdateRequestSchema } from "@xprtlink/shared/contracts";
import * as svc from "../services/expertService.js";

const router = Router();

router.get(
  "/featured",
  optionalAuthenticate,
  asyncHandler(async (_req, res) => {
    const data = await svc.getFeatured();
    return ResponseFormatter.success(res, { message: "Featured experts", data });
  })
);

router.get(
  "/me",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getExpertMe(req.auth);
    return ResponseFormatter.success(res, { message: "Expert profile", data });
  })
);

router.patch(
  "/me",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const body = expertMeUpdateRequestSchema.parse(req.body);
    const data = await svc.updateExpertMe(req.auth, body);
    return ResponseFormatter.success(res, { message: "Expert profile updated", data });
  })
);

router.post(
  "/me/onboarding",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.saveOnboarding(req.auth, req.body);
    return ResponseFormatter.success(res, { message: "Onboarding saved", data });
  })
);

router.post(
  "/me/onboarding/submit",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.submitOnboarding(req.auth);
    return ResponseFormatter.success(res, { message: "Onboarding submitted", data });
  })
);

router.get(
  "/me/verification",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getVerification(req.auth);
    return ResponseFormatter.success(res, { message: "Verification status", data });
  })
);

router.post(
  "/me/verification/documents",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.submitVerificationDocuments(req.auth, req.body);
    return ResponseFormatter.success(res, { message: "Documents submitted", data });
  })
);

router.get(
  "/me/dashboard",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getDashboard(req.auth);
    return ResponseFormatter.success(res, { message: "Dashboard", data });
  })
);

router.get(
  "/me/rating-summary",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getRatingSummary(req.auth);
    return ResponseFormatter.success(res, { message: "Rating summary", data });
  })
);

router.get(
  "/me/reviews",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getMyReviews(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: "Reviews", ...data });
  })
);

router.get(
  "/me/settings",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getSettings(req.auth);
    return ResponseFormatter.success(res, { message: "Settings", data });
  })
);

router.patch(
  "/me/settings",
  authenticate,
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.updateSettings(req.auth, req.body);
    return ResponseFormatter.success(res, { message: "Settings updated", data });
  })
);

router.get(
  "/:id/reviews",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getExpertReviews(req.params.id, req.query);
    return ResponseFormatter.paginated(res, { message: "Expert reviews", ...data });
  })
);

router.get(
  "/:id/availability",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getExpertAvailability(req.params.id);
    return ResponseFormatter.success(res, { message: "Availability", data });
  })
);

router.get(
  "/:id",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getExpertById(req.params.id, req.auth);
    return ResponseFormatter.success(res, { message: "Expert profile", data });
  })
);

export default router;
