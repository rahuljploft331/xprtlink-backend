import { Router } from "express";
import { list, getById } from "#controllers/consultations.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("consultations", "view"), asyncHandler(list));
router.get("/:id", requirePermission("consultations", "view"), asyncHandler(getById));
export default router;
