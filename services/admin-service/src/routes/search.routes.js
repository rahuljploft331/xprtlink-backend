import { Router } from "express";
import { globalSearch } from "#controllers/search.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";

const router = Router();
router.use(requireAdmin);

/** GET /api/v1/admin/search?q=... */
router.get("/", globalSearch);

export default router;
