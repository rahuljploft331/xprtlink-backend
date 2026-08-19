import { Router } from "express";
import { list, getBySlug, update } from "#controllers/cms.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("cms", "view"), list);
router.get("/:slug", requirePermission("cms", "view"), getBySlug);
router.put("/:slug", requirePermission("cms", "edit"), update);
export default router;
