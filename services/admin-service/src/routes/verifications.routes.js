import { Router } from "express";
import { list, getById, approve, reject } from "#controllers/verifications.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("verifications", "view"), list);
router.get("/:id", requirePermission("verifications", "view"), getById);
router.patch("/:id/approve", requirePermission("verifications", "edit"), approve);
router.patch("/:id/reject", requirePermission("verifications", "edit"), reject);
export default router;
