import { Router } from "express";
import { list, getById } from "#controllers/consultations.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("consultations", "view"), list);
router.get("/:id", requirePermission("consultations", "view"), getById);
export default router;
