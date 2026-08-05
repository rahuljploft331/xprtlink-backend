import { Router } from "express";
import { login, logout, me } from "#controllers/auth.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";

const router = Router();

/** POST /api/auth/login */
router.post("/login", login);

/** POST /api/auth/logout */
router.post("/logout", requireAdmin, logout);

/** GET /api/auth/me */
router.get("/me", requireAdmin, me);

export default router;
