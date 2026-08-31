import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate, requireRole } from "@xprtlink/shared/middleware/auth.js";
import { customerMeUpdateRequestSchema } from "@xprtlink/shared/contracts";
import * as svc from "../services/userService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

router.use(authenticate, requireRole("customer"));

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const data = await svc.getCustomerMe(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("profileLoaded"), data });
  })
);

router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const body = customerMeUpdateRequestSchema.parse(req.body);
    const data = await svc.updateCustomerMe(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("profileUpdated"), data });
  })
);

router.post(
  "/me/delete",
  asyncHandler(async (req, res) => {
    const data = await svc.deleteCustomerAccount(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("accountDeleted"), data });
  })
);

router.get(
  "/me/recently-viewed",
  asyncHandler(async (req, res) => {
    const data = await svc.getRecentlyViewed(req.auth, req.query);
    return ResponseFormatter.paginated(res, {
      message: getMessage("recentlyViewed"),
      ...data,
    });
  })
);

// POST /me/recently-viewed/:expertId removed — recording now happens
// automatically as a side effect of GET /api/v1/experts/:id (expert-service)

router.get(
  "/me/saved-experts",
  asyncHandler(async (req, res) => {
    const data = await svc.getSavedExperts(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("savedExperts"), ...data });
  })
);

router.post(
  "/me/saved-experts/:expertId",
  asyncHandler(async (req, res) => {
    const data = await svc.saveExpert(req.auth, req.params.expertId);
    return ResponseFormatter.success(res, { message: getMessage("expertSaved"), data });
  })
);

router.delete(
  "/me/saved-experts/:expertId",
  asyncHandler(async (req, res) => {
    const data = await svc.unsaveExpert(req.auth, req.params.expertId);
    return ResponseFormatter.success(res, { message: getMessage("expertUnsaved"), data });
  })
);

export default router;
