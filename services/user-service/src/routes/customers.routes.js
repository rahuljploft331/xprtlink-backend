import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate, requireRole } from "@xprtlink/shared/middleware/auth.js";
import { customerMeUpdateRequestSchema } from "@xprtlink/shared/contracts";
import * as svc from "../services/userService.js";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const data = await svc.getCustomerMe(req.auth);
    return ResponseFormatter.success(res, { message: "Profile loaded", data });
  })
);

router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const body = customerMeUpdateRequestSchema.parse(req.body);
    const data = await svc.updateCustomerMe(req.auth, body);
    return ResponseFormatter.success(res, { message: "Profile updated", data });
  })
);

router.post(
  "/me/delete",
  asyncHandler(async (req, res) => {
    const data = await svc.deleteCustomerAccount(req.auth);
    return ResponseFormatter.success(res, { message: "Account deleted", data });
  })
);

router.get(
  "/me/recently-viewed",
  asyncHandler(async (req, res) => {
    const data = await svc.getRecentlyViewed(req.auth, req.query);
    return ResponseFormatter.paginated(res, {
      message: "Recently viewed",
      ...data,
    });
  })
);

router.post(
  "/me/recently-viewed/:expertId",
  asyncHandler(async (req, res) => {
    const data = await svc.recordRecentlyViewed(req.auth, req.params.expertId);
    return ResponseFormatter.success(res, { message: "View recorded", data });
  })
);

router.get(
  "/me/saved-experts",
  asyncHandler(async (req, res) => {
    const data = await svc.getSavedExperts(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: "Saved experts", ...data });
  })
);

router.post(
  "/me/saved-experts/:expertId",
  asyncHandler(async (req, res) => {
    const data = await svc.saveExpert(req.auth, req.params.expertId);
    return ResponseFormatter.success(res, { message: "Expert saved", data });
  })
);

router.delete(
  "/me/saved-experts/:expertId",
  asyncHandler(async (req, res) => {
    const data = await svc.unsaveExpert(req.auth, req.params.expertId);
    return ResponseFormatter.success(res, { message: "Expert unsaved", data });
  })
);

export default router;
