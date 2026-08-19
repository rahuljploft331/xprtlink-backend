import { Router } from "express";
import { list, getById, approve, reject } from "#controllers/verifications.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("verifications", "view"), asyncHandler(list));
router.get("/:id", requirePermission("verifications", "view"), asyncHandler(getById));
router.patch("/:id/approve", requirePermission("verifications", "edit"), asyncHandler(approve));
router.patch("/:id/reject", requirePermission("verifications", "edit"), asyncHandler(reject));
export default router;
