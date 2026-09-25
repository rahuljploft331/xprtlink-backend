import { Router } from "express";
import {
  list,
  getById,
  markPaid,
  expertSummary,
  payExpertNow,
  retry,
} from "#controllers/payouts.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("payouts", "view"), asyncHandler(list));
router.get("/experts/:expertProfileId/summary", requirePermission("payouts", "view"), asyncHandler(expertSummary));
router.post("/experts/:expertProfileId/pay", requirePermission("payouts", "edit"), asyncHandler(payExpertNow));
router.get("/:id", requirePermission("payouts", "view"), asyncHandler(getById));
router.post("/:id/retry", requirePermission("payouts", "edit"), asyncHandler(retry));
router.patch("/:id/mark-paid", requirePermission("payouts", "edit"), asyncHandler(markPaid));
export default router;
