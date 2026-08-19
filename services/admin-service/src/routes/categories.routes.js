import { Router } from "express";
import { list, getById, create, update, remove } from "#controllers/categories.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("categories", "view"), list);
router.get("/:id", requirePermission("categories", "view"), getById);
router.post("/", requirePermission("categories", "edit"), create);
router.patch("/:id", requirePermission("categories", "edit"), update);
router.delete("/:id", requirePermission("categories", "edit"), remove);
export default router;
