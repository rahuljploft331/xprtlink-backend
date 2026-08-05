import { Router } from "express";
import { list, getById } from "#controllers/subscriptions.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";
const router = Router();
router.use(requireAdmin);
router.get("/", list);
router.get("/:id", getById);
export default router;
