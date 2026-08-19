import { Router } from "express";
import { list, getById } from "#controllers/subscriptions.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("subscriptions", "view"), list);
router.get("/:id", requirePermission("subscriptions", "view"), getById);
export default router;
