import { Router } from "express";
import { list, getById } from "#controllers/notifications.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("notifications", "view"), list);
router.get("/:id", requirePermission("notifications", "view"), getById);
export default router;
