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
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 20px; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
  </style>
</head>
<body>
  <h1>${data.title}</h1>
  ${data.bodyHtml || ""}
</body>
</html>`;
    res.setHeader("Content-Type", "text/html");
    return res.send(html);
  })
);

export default router;
