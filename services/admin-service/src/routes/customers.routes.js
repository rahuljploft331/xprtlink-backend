import { Router } from "express";
import { list, getById } from "#controllers/customers.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("customers", "view"), asyncHandler(list));
router.get("/:id", requirePermission("customers", "view"), asyncHandler(getById));
export default router;
