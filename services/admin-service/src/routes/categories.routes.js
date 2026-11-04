import { Router } from "express";
import { list, getById, create, update, remove, reorder, listSuggestions, approveSuggestion, dismissSuggestion } from "#controllers/categories.controller.js";
import { requireAdmin, requirePermission } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();
router.use(requireAdmin);
router.get("/", requirePermission("categories", "view"), asyncHandler(list));
router.put("/reorder", requirePermission("categories", "edit"), asyncHandler(reorder));
router.get("/suggestions", requirePermission("categories", "view"), asyncHandler(listSuggestions));
router.post("/suggestions/approve", requirePermission("categories", "edit"), asyncHandler(approveSuggestion));
router.post("/suggestions/dismiss", requirePermission("categories", "edit"), asyncHandler(dismissSuggestion));
router.get("/:id", requirePermission("categories", "view"), asyncHandler(getById));
router.post("/", requirePermission("categories", "edit"), asyncHandler(create));
router.patch("/:id", requirePermission("categories", "edit"), asyncHandler(update));
router.delete("/:id", requirePermission("categories", "edit"), asyncHandler(remove));
export default router;
