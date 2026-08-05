import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: "expert-service scaffold",
    data: {
      service: "expert-service",
      status: "scaffold",
      owns: ["profiles","verification","availability","search"],
    },
  });
});

export default router;
