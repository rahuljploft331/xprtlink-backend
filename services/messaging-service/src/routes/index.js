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


import { getIo } from "../sockets/messagingSocket.js";

router.post("/internal/events/user-blocked", (req, res) => {
  const { blockerUserId, blockedUserId, blockerProfileIds, blockedProfileIds } = req.body;
  const io = getIo();
  if (io) {
    console.log("EMITTING user:blocked", { blockerUserId, blockedUserId, blockerProfileIds, blockedProfileIds });
    io.to(`user:${blockerUserId}`).to(`user:${blockedUserId}`).emit("user:blocked", {
      blockerUserId,
      blockedUserId,
      blockerProfileIds,
      blockedProfileIds,
    });
  }
  return res.json({ success: true });
});

router.post("/internal/events/user-unblocked", (req, res) => {
  const { blockerUserId, blockedUserId, blockerProfileIds, blockedProfileIds } = req.body;
  const io = getIo();
  if (io) {
    io.to(`user:${blockerUserId}`).to(`user:${blockedUserId}`).emit("user:unblocked", {
      blockerUserId,
      blockedUserId,
      blockerProfileIds,
      blockedProfileIds,
    });
  }
  return res.json({ success: true });
});

export default router;
