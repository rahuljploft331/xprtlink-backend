import { Router } from "express";
import { list, create, update, remove } from "#controllers/faqs.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);

router.get("/", requirePermission("cms", "view"), asyncHandler(list));
router.post("/", requirePermission("cms", "edit"), asyncHandler(create));
router.put("/:id", requirePermission("cms", "edit"), asyncHandler(update));
router.delete("/:id", requirePermission("cms", "edit"), asyncHandler(remove));

export default router;
