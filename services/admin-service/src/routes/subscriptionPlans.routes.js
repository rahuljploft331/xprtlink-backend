import { Router } from "express";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { list, getById, update } from "#controllers/subscriptionPlans.controller.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

router.get(
  "/",
  requirePermission("subscriptions", "view"),
  asyncHandler(async (req, res) => {
    const data = await list(req, res);
    return ResponseFormatter.success(res, { data });
  })
);

router.get(
  "/:id",
  requirePermission("subscriptions", "view"),
  asyncHandler(async (req, res) => {
    const data = await getById(req, res);
    return ResponseFormatter.success(res, { data });
  })
);

router.put(
  "/:id",
  requirePermission("subscriptions", "edit"),
  asyncHandler(async (req, res) => {
    const data = await update(req, res);
    return ResponseFormatter.success(res, { data, message: "Subscription Plan updated successfully" });
  })
);

export default router;
