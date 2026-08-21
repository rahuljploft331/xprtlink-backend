
import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate, optionalAuthenticate } from "@xprtlink/shared/middleware/auth.js";
import { createUploadRequestSchema } from "@xprtlink/shared/contracts";
import * as svc from "../services/mediaService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

// Public: Get configured chat attachment limits (Document, Image, Video)
router.get(
  "/config/attachments",
  asyncHandler(async (_req, res) => {
    const data = svc.getAttachmentSettings();
    return ResponseFormatter.success(res, {
      message: getMessage("chatAttachmentConfiguration"),
      data,
    });
  })
);



// Authenticated Routes
router.use(authenticate);

// Create Presigned Upload URL (Single Source of Truth)
router.post(
  "/uploads",
  asyncHandler(async (req, res) => {
    const body = createUploadRequestSchema.parse(req.body);
    const data = await svc.createUpload(req.auth, body);
    return ResponseFormatter.success(res, {
      message: getMessage("uploadCreated"),
      data,
      status: 201,
    });
  })
);

// Confirm Upload
router.post(
  "/:id/confirm",
  asyncHandler(async (req, res) => {
    const data = await svc.confirmUpload(req.auth, req.params.id);
    return ResponseFormatter.success(res, {
      message: getMessage("uploadConfirmed"),
      data,
    });
  })
);

// Get Media Asset Info
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = await svc.getMediaAsset(req.auth, req.params.id);
    return ResponseFormatter.success(res, {
      message: getMessage("mediaAsset"),
      data,
    });
  })
);

export default router;
