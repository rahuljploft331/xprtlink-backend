import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import * as svc from "../services/engagementService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

router.use(authenticate);

router.get(
  "/pending",
  asyncHandler(async (req, res) => {
    const data = await svc.getPendingReviews(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("pendingReviewsLoaded"), ...data });
  })
);

export default router;
