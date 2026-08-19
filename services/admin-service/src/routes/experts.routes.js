import { Router } from "express";
import { list, getById } from "#controllers/experts.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("experts", "view"), list);
router.get("/:id", requirePermission("experts", "view"), getById);
export default router;
