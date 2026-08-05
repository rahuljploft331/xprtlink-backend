import { Router } from "express";
import { list, getBySlug, update } from "#controllers/cms.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";
const router = Router();
router.use(requireAdmin);
router.get("/", list);
router.get("/:slug", getBySlug);
router.put("/:slug", update);
export default router;
