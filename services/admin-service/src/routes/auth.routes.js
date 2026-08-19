import { Router } from "express";
import { login, logout, me } from "#controllers/auth.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";

const router = Router();

/** POST /api/auth/login */
router.post("/login", asyncHandler(login));

/** POST /api/auth/logout */
router.post("/logout", requireAdmin, asyncHandler(logout));

/** GET /api/auth/me */
router.get("/me", requireAdmin, asyncHandler(me));

export default router;
