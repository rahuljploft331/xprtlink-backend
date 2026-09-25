import { Router } from "express";
import crypto from "crypto";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";

// ── Internal-route guard — validates x-internal-service header against SERVICE_SECRET ──
function internalServiceGuard(req, res, next) {
  const secret = process.env.SERVICE_SECRET;
  if (!secret) {
    return res.status(500).json({ success: false, message: "Internal Server Error: Missing SERVICE_SECRET" });
  }

  const header = req.headers["x-internal-service"];
  if (!header || typeof header !== "string") {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const secretBuffer = Buffer.from(secret);
  const headerBuffer = Buffer.from(header);

  if (secretBuffer.length !== headerBuffer.length || !crypto.timingSafeEqual(secretBuffer, headerBuffer)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  next();
}

const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: getMessage("xprtlinkMessagingServiceWebsocketProtocolOnly"),
    data: { service: "messaging-service", protocol: "socket.io", version: "v1" },
  });
});


import { getIo } from "../sockets/messagingSocket.js";

router.post("/internal/events/user-blocked", internalServiceGuard, (req, res) => {
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

router.post("/internal/events/user-unblocked", internalServiceGuard, (req, res) => {
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

router.post("/internal/events/account-disabled", internalServiceGuard, (req, res) => {
  const { userId } = req.body;
  const io = getIo();
  if (io) {
    console.log("EMITTING account:disabled", { userId });
    io.to(`user:${userId}`).emit("account:disabled", { userId });

    // Give the client a tiny moment to receive the event, then forcibly disconnect their sockets
    setTimeout(() => {
      io.in(`user:${userId}`).disconnectSockets(true);
    }, 1000);
  }
  return res.json({ success: true });
});

export default router;
