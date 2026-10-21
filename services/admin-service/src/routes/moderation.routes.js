import { Router } from "express";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { listReportedExperts, listReportedCustomers, updateExpertReport, updateCustomerReport, listBanners, approveBanner, rejectBanner } from "#controllers/moderation.controller.js";

const router = Router();
router.use(requireAdmin);

router.get("/expert-reports", requirePermission("experts", "view"), asyncHandler(listReportedExperts));
router.patch("/expert-reports/:id", requirePermission("experts", "edit"), asyncHandler(updateExpertReport));

router.get("/customer-reports", requirePermission("customers", "view"), asyncHandler(listReportedCustomers));
router.patch("/customer-reports/:id", requirePermission("customers", "edit"), asyncHandler(updateCustomerReport));

router.get("/banners", requirePermission("experts", "view"), asyncHandler(listBanners));
router.patch("/banners/:id/approve", requirePermission("experts", "edit"), asyncHandler(approveBanner));
router.patch("/banners/:id/reject", requirePermission("experts", "edit"), asyncHandler(rejectBanner));


export default router;
