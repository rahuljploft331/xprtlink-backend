import { Router } from "express";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { listReportedExperts, listReportedCustomers, updateExpertReport, updateCustomerReport, listBanners, approveBanner, rejectBanner, toggleBannerActive, deleteBanner } from "#controllers/moderation.controller.js";

const router = Router();
router.use(requireAdmin);

router.get("/expert-reports", requirePermission(["moderation", "experts"], "view"), asyncHandler(listReportedExperts));
router.patch("/expert-reports/:id", requirePermission(["moderation", "experts"], "edit"), asyncHandler(updateExpertReport));

router.get("/customer-reports", requirePermission(["moderation", "customers"], "view"), asyncHandler(listReportedCustomers));
router.patch("/customer-reports/:id", requirePermission(["moderation", "customers"], "edit"), asyncHandler(updateCustomerReport));

router.get("/banners", requirePermission(["moderation", "experts"], "view"), asyncHandler(listBanners));
router.patch("/banners/:id/approve", requirePermission(["moderation", "experts"], "edit"), asyncHandler(approveBanner));
router.patch("/banners/:id/reject", requirePermission(["moderation", "experts"], "edit"), asyncHandler(rejectBanner));
router.patch("/banners/:id/toggle-active", requirePermission(["moderation", "experts"], "edit"), asyncHandler(toggleBannerActive));
router.delete("/banners/:id", requirePermission(["moderation", "experts"], "edit"), asyncHandler(deleteBanner));

export default router;
