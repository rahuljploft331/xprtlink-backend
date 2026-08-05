import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: "messaging-service scaffold",
    data: {
      service: "messaging-service",
      status: "scaffold",
      owns: ["conversations","messages","socket"],
    },
  });
});

export default router;
