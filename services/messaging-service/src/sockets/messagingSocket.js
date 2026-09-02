import { verifyAccessToken } from "@xprtlink/shared/auth/jwt.js";
import { getDb } from "@xprtlink/shared/db";
import {
  createConversationRequestSchema,
  sendMessageRequestSchema,
} from "@xprtlink/shared/contracts";
import * as svc from "../services/messagingService.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";

/**
 * Register Socket.IO authentication and event listeners for real-time messaging.
 * @param {import("socket.io").Server} io
 */
export function registerMessagingSockets(io) {
  // Handshake authentication middleware
  io.use(async (socket, next) => {
    try {
      let token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization ||
        socket.handshake.query?.token;

      if (!token) {
        return next(new Error("Authentication token required"));
      }

      if (typeof token === "string" && token.startsWith("Bearer ")) {
        token = token.slice(7);
      }

      const payload = verifyAccessToken(token);

      // Check user status in DB to enforce bans/suspensions on WebSocket connections
      const user = await getDb().user.findUnique({
        where: { id: payload.sub },
        select: { status: true },
      });
      if (!user || user.status !== "active") {
        return next(new Error("Account suspended or deleted"));
      }

      socket.data.auth = {
        userId: payload.sub,
        role: payload.role,
        customerProfileId: payload.customerProfileId ?? null,
        expertProfileId: payload.expertProfileId ?? null,
      };

      next();
    } catch (err) {
      return next(new Error("Invalid or expired authentication token"));
    }
  });

  io.on("connection", (socket) => {
    const auth = socket.data.auth;
    const userRoom = `user:${auth.userId}`;
    socket.join(userRoom);
    if (auth.customerProfileId) socket.join(`customer:${auth.customerProfileId}`);
    if (auth.expertProfileId) socket.join(`expert:${auth.expertProfileId}`);

    console.log(
      `[messaging-service] User connected: ${auth.userId} (${auth.role}) -> socket ${socket.id}`
    );

    // 1. List conversations
    socket.on("conversation:list", async (payload = {}, callback) => {
      try {
        const data = await svc.listConversations(auth, payload);
        if (typeof callback === "function") {
          callback({ success: true, data });
        }
      } catch (err) {
        console.error("[messaging-service] conversation:list error:", err.message);
        if (typeof callback === "function") {
          callback({
            success: false,
            message: err.message || "Failed to list conversations",
            code: err.code || "INTERNAL_ERROR",
          });
        }
      }
    });

    // 2. Create or get conversation thread
    socket.on("conversation:create", async (payload = {}, callback) => {
      try {
        const validated = createConversationRequestSchema.parse(payload);
        const data = await svc.createConversation(auth, validated);
        
        socket.join(`conversation:${data.id}`);

        // Notify peer user if online
        const peerUserId = await svc.getConversationPeerUserId(data.id, auth.userId);
        if (peerUserId) {
          io.to(`user:${peerUserId}`).emit("conversation:new", { conversation: data });
        }

        if (typeof callback === "function") {
          callback({ success: true, data });
        }
      } catch (err) {
        console.error("[messaging-service] conversation:create error:", err.message);
        if (typeof callback === "function") {
          callback({
            success: false,
            message: err.message || "Failed to create conversation",
            code: err.code || "INTERNAL_ERROR",
          });
        }
      }
    });

    // 3. Join conversation room
    socket.on("conversation:join", async ({ conversationId } = {}, callback) => {
      try {
        if (!conversationId) throw new Error("conversationId is required");
        await svc.loadConversation(auth, conversationId);
        socket.join(`conversation:${conversationId}`);

        if (typeof callback === "function") {
          callback({ success: true, data: { conversationId, joined: true } });
        }
      } catch (err) {
        console.error("[messaging-service] conversation:join error:", err.message);
        if (typeof callback === "function") {
          callback({
            success: false,
            message: err.message || "Failed to join conversation",
            code: err.code || "FORBIDDEN",
          });
        }
      }
    });

    // 4. Leave conversation room
    socket.on("conversation:leave", ({ conversationId } = {}, callback) => {
      if (conversationId) {
        socket.leave(`conversation:${conversationId}`);
      }
      if (typeof callback === "function") {
        callback({ success: true, data: { conversationId, left: true } });
      }
    });

    // 5. Message history (paginated)
    socket.on("message:history", async (payload = {}, callback) => {
      try {
        const { conversationId, ...query } = payload;
        if (!conversationId) throw new Error("conversationId is required");
        const data = await svc.listMessages(auth, conversationId, query);

        if (typeof callback === "function") {
          callback({ success: true, data });
        }
      } catch (err) {
        console.error("[messaging-service] message:history error:", err.message);
        if (typeof callback === "function") {
          callback({
            success: false,
            message: err.message || "Failed to load messages",
            code: err.code || "INTERNAL_ERROR",
          });
        }
      }
    });

    // 6. Send message
    socket.on("message:send", async (payload = {}, callback) => {
      try {
        const { conversationId, ...body } = payload;
        if (!conversationId) throw new Error("conversationId is required");
        const validated = sendMessageRequestSchema.parse(body);
        const message = await svc.sendMessage(auth, conversationId, validated);

        // Broadcast to conversation room (realtime chat inside thread)
        io.to(`conversation:${conversationId}`).emit("message:new", {
          conversationId,
          message,
        });

        // Notify peer's user room for badge/inbox preview updates
        const peerUserId = await svc.getConversationPeerUserId(conversationId, auth.userId);
        if (peerUserId) {
          io.to(`user:${peerUserId}`).emit("conversation:updated", {
            conversationId,
            lastMessage: message,
            senderUserId: auth.userId,
          });

          // Also create a persistent in-app notification record so the peer
          // sees a badge even if they were offline when the message arrived.
          try {
            const peerSockets = await io.in(`user:${peerUserId}`).fetchSockets();
            if (peerSockets.length === 0) {
              const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
              const preview = message.body
                ? message.body.slice(0, 80) + (message.body.length > 80 ? "..." : "")
                : "Sent an attachment";
              await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
                userIds: [peerUserId],
                type: "new_message",
                title: "New Message",
                body: preview,
                data: { conversationId, messageId: message.id, senderUserId: auth.userId },
              });
            }
          } catch (err) {
            console.error(`[messaging:message:send] Notification dispatch failed: ${err.message}`);
          }
        }

        if (typeof callback === "function") {
          callback({ success: true, data: message });
        }
      } catch (err) {
        console.error("[messaging-service] message:send error:", err.message);
        if (typeof callback === "function") {
          callback({
            success: false,
            message: err.message || "Failed to send message",
            code: err.code || "INTERNAL_ERROR",
          });
        }
      }
    });

    // 7. Mark conversation read
    socket.on("message:read", async ({ conversationId } = {}, callback) => {
      try {
        if (!conversationId) throw new Error("conversationId is required");
        const result = await svc.markConversationRead(auth, conversationId);

        // Broadcast read receipt to conversation room
        io.to(`conversation:${conversationId}`).emit("conversation:read", {
          conversationId,
          userId: auth.userId,
          readAt: new Date().toISOString(),
        });

        if (typeof callback === "function") {
          callback({ success: true, data: result });
        }
      } catch (err) {
        console.error("[messaging-service] message:read error:", err.message);
        if (typeof callback === "function") {
          callback({
            success: false,
            message: err.message || "Failed to mark conversation read",
            code: err.code || "INTERNAL_ERROR",
          });
        }
      }
    });

    // 8. P2P Signaling (for incoming calls, etc.)
    socket.on("signal", (payload = {}, callback) => {
      try {
        const { targetUserId, type, data } = payload;
        if (targetUserId) {
          // targetUserId could be a userId, customerProfileId, or expertProfileId.
          // Broadcast to all three potential room names to guarantee delivery.
          io.to(`user:${targetUserId}`)
            .to(`customer:${targetUserId}`)
            .to(`expert:${targetUserId}`)
            .emit("signal", {
              type,
              data,
              senderUserId: auth.userId,
            });
        }
        if (typeof callback === "function") {
          callback({ success: true });
        }
      } catch (err) {
        console.error("[messaging-service] signal error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message });
        }
      }
    });

    // 8. Typing indicators
    socket.on("typing:start", ({ conversationId } = {}) => {
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit("typing:status", {
          conversationId,
          userId: auth.userId,
          isTyping: true,
        });
      }
    });

    socket.on("typing:stop", ({ conversationId } = {}) => {
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit("typing:status", {
          conversationId,
          userId: auth.userId,
          isTyping: false,
        });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(
        `[messaging-service] User disconnected: ${auth.userId} (${socket.id}) - reason: ${reason}`
      );
    });
  });
}
