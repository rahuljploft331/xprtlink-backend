import { Router } from "express";
import { list, getById, approve, reject, removeDocument } from "#controllers/verifications.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("verifications", "view"), asyncHandler(list));
router.get("/:id", requirePermission("verifications", "view"), asyncHandler(getById));
router.patch("/:id/approve", requirePermission("verifications", "edit"), asyncHandler(approve));
router.patch("/:id/reject", requirePermission("verifications", "edit"), asyncHandler(reject));
router.delete("/:id/documents/:docId", requirePermission("verifications", "edit"), asyncHandler(removeDocument));
export default router;
