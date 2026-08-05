import { Router } from "express";
import { list, getById, approve, reject } from "#controllers/verifications.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";

const router = Router();
router.use(requireAdmin);
router.get("/", list);
router.get("/:id", getById);
router.patch("/:id/approve", approve);
router.patch("/:id/reject", reject);
export default router;
