import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import * as svc from "../services/engagementService.js";

const router = Router();

router.use(authenticate);

router.get(
  "/pending",
  asyncHandler(async (req, res) => {
    const data = await svc.getPendingReviews(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: "Pending reviews loaded", ...data });
  })
);

export default router;
