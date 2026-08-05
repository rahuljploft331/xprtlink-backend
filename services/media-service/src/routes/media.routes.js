import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { createUploadRequestSchema } from "@xprtlink/shared/contracts";
import * as svc from "../services/mediaService.js";

const router = Router();

router.use(authenticate);

router.post(
  "/uploads",
  asyncHandler(async (req, res) => {
    const body = createUploadRequestSchema.parse(req.body);
    const data = await svc.createUpload(req.auth, body);
    return ResponseFormatter.success(res, { message: "Upload created", data, status: 201 });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = await svc.getMediaAsset(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: "Media asset", data });
  })
);

export default router;
