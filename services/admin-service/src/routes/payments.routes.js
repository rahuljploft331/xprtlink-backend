import { Router } from "express";
import { list, getById } from "#controllers/payments.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("payments", "view"), list);
router.get("/:id", requirePermission("payments", "view"), getById);
export default router;
