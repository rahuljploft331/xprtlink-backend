import { Router } from "express";
import { list, getById, setFeatured } from "#controllers/experts.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("experts", "view"), asyncHandler(list));
router.get("/:id", requirePermission("experts", "view"), asyncHandler(getById));
router.patch("/:id/featured", requirePermission("experts", "edit"), asyncHandler(setFeatured));
export default router;
