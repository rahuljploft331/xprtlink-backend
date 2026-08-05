import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: "catalog-service scaffold",
    data: {
      service: "catalog-service",
      status: "scaffold",
      owns: ["categories","banners","cms"],
    },
  });
});

export default router;
