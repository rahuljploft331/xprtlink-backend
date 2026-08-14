import { Router } from "express";
import { getSummary } from "#controllers/reports.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";

const router = Router();

router.use(requireAdmin);

/** GET /api/v1/admin/reports/summary */
router.get("/summary", getSummary);

export default router;
