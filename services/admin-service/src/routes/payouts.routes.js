import { Router } from "express";
import { list, getById, markPaid } from "#controllers/payouts.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("payouts", "view"), list);
router.get("/:id", requirePermission("payouts", "view"), getById);
router.patch("/:id/mark-paid", requirePermission("payouts", "edit"), markPaid);
export default router;
