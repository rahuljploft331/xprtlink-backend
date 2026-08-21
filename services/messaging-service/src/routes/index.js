import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: getMessage("xprtlinkMessagingServiceWebsocketProtocolOnly"),
    data: { service: "messaging-service", protocol: "socket.io", version: "v1" },
  });
});

export default router;
