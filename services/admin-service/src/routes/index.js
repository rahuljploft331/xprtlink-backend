import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: "admin-service scaffold",
    data: {
      service: "admin-service",
      status: "scaffold",
      owns: ["admins","subadmins","permissions","audit","reports"],
    },
  });
});

export default router;
