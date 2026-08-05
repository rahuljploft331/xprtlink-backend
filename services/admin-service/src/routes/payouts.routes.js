import { Router } from "express";
import { list, getById, markPaid } from "#controllers/payouts.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";
const router = Router();
router.use(requireAdmin);
router.get("/", list);
router.get("/:id", getById);
router.patch("/:id/mark-paid", markPaid);
export default router;
