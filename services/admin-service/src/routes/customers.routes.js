import { Router } from "express";
import { list, getById } from "#controllers/customers.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("customers", "view"), list);
router.get("/:id", requirePermission("customers", "view"), getById);
export default router;
