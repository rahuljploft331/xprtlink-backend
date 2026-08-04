import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: "search-service scaffold",
    data: { service: "search-service", status: "scaffold" },
  });
});

export default router;
