import { Router } from "express";
import { checkInvite, acceptInvite } from "#controllers/admins.controller.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
const router = Router();
// Public — no auth required
router.get("/:token", asyncHandler(checkInvite));
router.post("/:token/accept", asyncHandler(acceptInvite));
export default router;
