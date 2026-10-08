import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { optionalAuthenticate } from "@xprtlink/shared/middleware/auth.js";
import * as svc from "../services/catalogService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

router.get(
  "/app-config",
  asyncHandler(async (_req, res) => {
    const data = await svc.getAppConfig();
    return ResponseFormatter.success(res, { message: getMessage("appConfig"), data });
  })
);

router.get(
  "/categories",
  optionalAuthenticate,
  asyncHandler(async (_req, res) => {
    const data = await svc.getCategories();
    return ResponseFormatter.success(res, { message: getMessage("categories"), data });
  })
);

router.get(
  "/cms/:slug",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getCmsPage(req.params.slug);
    const content = data.bodyHtml || "";
    
    // If the CMS content is already a full HTML document (raw HTML mode), serve it directly
    if (content.toLowerCase().includes("<html") || content.toLowerCase().includes("<!doctype")) {
      res.setHeader("Content-Type", "text/html");
      return res.send(content);
    }

    // Otherwise, wrap it in the default layout (for visual editor content)
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
  ${content}
</body>
</html>`;
    res.setHeader("Content-Type", "text/html");
    return res.send(html);
  })
);

router.get(
  "/faqs",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getFaqs({ type: req.query.type });
    return ResponseFormatter.success(res, { message: getMessage("faqsFetched"), data });
  })
);

export default router;
