import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

/**
 * Gateway scaffold — path rewrite / proxy wiring comes later.
 * Public API shape: /api/v1/<domain>/*
 */
router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: "XprtLink API Gateway",
    data: {
      version: "v1",
      status: "scaffold",
    },
  });
});

export default router;
