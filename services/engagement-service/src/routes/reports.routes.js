import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { expertReportRequestSchema } from "@xprtlink/shared/contracts";
import * as svc from "../services/engagementService.js";

const router = Router();

router.use(authenticate);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = expertReportRequestSchema.parse(req.body);
    const data = await svc.createReport(req.auth, body);
    return ResponseFormatter.success(res, { message: "Report submitted", data, status: 201 });
  })
);

export default router;
