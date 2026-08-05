import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: "billing-service scaffold",
    data: {
      service: "billing-service",
      status: "scaffold",
      owns: ["payments","subscriptions","payouts","transactions"],
    },
  });
});

export default router;
