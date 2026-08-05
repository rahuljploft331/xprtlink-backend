import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: "engagement-service scaffold",
    data: {
      service: "engagement-service",
      status: "scaffold",
      owns: ["quotes","consultations","reviews-submit"],
    },
  });
});

export default router;
