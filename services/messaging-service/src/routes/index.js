import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: "XprtLink Messaging Service (WebSocket Protocol Only)",
    data: { service: "messaging-service", protocol: "socket.io", version: "v1" },
  });
});

export default router;
