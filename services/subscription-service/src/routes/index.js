import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: "subscription-service scaffold",
    data: { service: "subscription-service", status: "scaffold" },
  });
});

export default router;
