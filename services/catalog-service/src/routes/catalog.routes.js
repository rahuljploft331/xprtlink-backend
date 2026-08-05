import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { optionalAuthenticate } from "@xprtlink/shared/middleware/auth.js";
import * as svc from "../services/catalogService.js";

const router = Router();

router.get(
  "/app-config",
  asyncHandler(async (_req, res) => {
    const data = await svc.getAppConfig();
    return ResponseFormatter.success(res, { message: "App config", data });
  })
);

router.get(
  "/categories",
  optionalAuthenticate,
  asyncHandler(async (_req, res) => {
    const data = await svc.getCategories();
    return ResponseFormatter.success(res, { message: "Categories", data });
  })
);

router.get(
  "/cms/:slug",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getCmsPage(req.params.slug);
    return ResponseFormatter.success(res, { message: "CMS page", data });
  })
);

export default router;
