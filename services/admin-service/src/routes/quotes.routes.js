import { Router } from "express";
import { list, getById } from "#controllers/quotes.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("quotes", "view"), list);
router.get("/:id", requirePermission("quotes", "view"), getById);
export default router;
