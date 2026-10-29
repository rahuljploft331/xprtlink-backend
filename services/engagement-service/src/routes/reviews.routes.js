import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { validateUUID } from "@xprtlink/shared/middleware/validateUUID.js";
import * as svc from "../services/engagementService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { getDb } from "@xprtlink/shared/db";
import { notFound, badRequest, conflict, forbidden } from "@xprtlink/shared/utils/errors.js";
import { normalizeReportInput } from "@xprtlink/shared/utils/reportReasons.js";

const router = Router();
const requireUuidId = validateUUID("id");

router.use(authenticate);

router.get(
  "/pending",
  asyncHandler(async (req, res) => {
    const data = await svc.getPendingReviews(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("pendingReviewsLoaded"), ...data });
  })
);

router.post(
  "/:id/report",
  requireUuidId,
  asyncHandler(async (req, res) => {
    const { role, customerProfileId, expertProfileId } = req.auth;
    if (role !== "customer" && role !== "expert") throw forbidden();

    const db = getDb();
    const review = await db.review.findUnique({ where: { id: req.params.id } });
    if (!review) throw notFound("reviewNotFound");
    if (review.status !== "published") throw badRequest("reviewNotReportable");

    if (role === "customer" && review.customerId === customerProfileId) {
      throw badRequest("cannotReportOwnReview");
    }
    if (role === "expert" && review.expertId !== expertProfileId) {
      throw forbidden();
    }

    const { reason, details } = normalizeReportInput(req.body);

    const uniqueWhere =
      role === "customer"
        ? { reviewId_reporterCustomerId: { reviewId: review.id, reporterCustomerId: customerProfileId } }
        : { reviewId_reporterExpertId: { reviewId: review.id, reporterExpertId: expertProfileId } };

    const existing = await db.reviewReport.findUnique({ where: uniqueWhere });
    if (existing) throw conflict("reviewAlreadyReported");

    await db.$transaction([
      db.reviewReport.create({
        data: {
          reviewId: review.id,
          reporterRole: role,
          reporterCustomerId: role === "customer" ? customerProfileId : null,
          reporterExpertId: role === "expert" ? expertProfileId : null,
          reason,
          details,
        },
      }),
      db.review.update({ where: { id: review.id }, data: { status: "flagged" } }),
    ]);

    return ResponseFormatter.success(res, { message: getMessage("reviewReported"), status: 201 });
  })
);

export default router;
