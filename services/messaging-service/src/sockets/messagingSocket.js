import { getMessage } from "@xprtlink/shared/utils/messages.js";
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
let _io = null;
export function getIo() { return _io; }

export function registerMessagingSockets(io) {
  _io = io;
  // Handshake authentication middleware
  io.use(async (socket, next) => {
    try {
      let token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization ||
        socket.handshake.query?.token;

      if (!token) {
        return next(new Error(getMessage("authTokenRequired")));
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
        return next(new Error(getMessage("accountSuspendedOrDeleted")));
      }

      socket.data.auth = {
        userId: payload.sub,
        role: payload.role,
        customerProfileId: payload.customerProfileId ?? null,
        expertProfileId: payload.expertProfileId ?? null,
      };

      next();
    } catch (err) {
      return next(new Error(getMessage("invalidOrExpiredAuthToken")));
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
            message: err.message || getMessage("failedToListConversations"),
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
            message: err.message || getMessage("failedToCreateConversation"),
            code: err.code || "INTERNAL_ERROR",
          });
        }
      }
    });

    // 3. Join conversation room
    socket.on("conversation:join", async ({ conversationId } = {}, callback) => {
      try {
        if (!conversationId) throw new Error(getMessage("conversationIdRequired"));
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
            message: err.message || getMessage("failedToJoinConversation"),
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
        if (!conversationId) throw new Error(getMessage("conversationIdRequired"));
        const data = await svc.listMessages(auth, conversationId, query);

        if (typeof callback === "function") {
          callback({ success: true, data });
        }
      } catch (err) {
        console.error("[messaging-service] message:history error:", err.message);
        if (typeof callback === "function") {
          callback({
            success: false,
            message: err.message || getMessage("failedToLoadMessages"),
            code: err.code || "INTERNAL_ERROR",
          });
        }
      }
    });

    // 6. Send message
    socket.on("message:send", async (payload = {}, callback) => {
      console.log(`[messaging-service] message:send received for conversation: ${payload.conversationId}`);
      try {
        const { conversationId, ...body } = payload;
        if (!conversationId) throw new Error(getMessage("conversationIdRequired"));
        const validated = sendMessageRequestSchema.parse(body);
        const message = await svc.sendMessage(auth, conversationId, validated);
        console.log(`[messaging-service] message:send - Message created in DB: ${message.id}`);

        // Broadcast to conversation room (realtime chat inside thread)
        io.to(`conversation:${conversationId}`).emit("message:new", {
          conversationId,
          message,
        });

        // Notify peer's user room for badge/inbox preview updates
        const peerUserId = await svc.getConversationPeerUserId(conversationId, auth.userId);
        console.log(`[messaging-service] message:send - Resolved peerUserId: ${peerUserId}`);
        if (peerUserId) {
          console.log(`[messaging-service] message:send - Emitting inbox:updated to user:${peerUserId}`);
          io.to(`user:${peerUserId}`).emit("inbox:updated", {
            conversationId,
            lastMessage: message,
            senderUserId: auth.userId,
          });

          // sees a badge even if they were offline when the message arrived.
          try {
            // Fetch all sockets currently in this specific conversation room
            const roomSockets = await io.in(`conversation:${conversationId}`).fetchSockets();
            console.log(`[messaging-service] message:send - Sockets in room: ${roomSockets.length}. Details:`, JSON.stringify(roomSockets.map(s => ({ id: s.id, auth: s.data.auth }))));
            // Check if the peer has any socket actively in this room
            const peerIsActiveInRoom = roomSockets.some(s => s.data.auth?.userId === peerUserId);
            console.log(`[messaging-service] message:send - Is peer active in room? ${peerIsActiveInRoom} (Target peerUserId: ${peerUserId})`);

            // If they are not actively looking at this conversation room, dispatch a notification
            if (!peerIsActiveInRoom) {
              const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
              const preview = message.body
                ? message.body.slice(0, 80) + (message.body.length > 80 ? "..." : "")
                : "Sent an attachment";
              
              let senderName = "New Message";
              let senderAvatarUrl = null;
              try {
                const info = await svc.getConversationSenderInfo(conversationId, auth);
                senderName = info.name;
                senderAvatarUrl = info.avatarUrl;
              } catch (e) {
                console.warn(`[messaging-service] Failed to get sender info for push:`, e.message);
              }

              console.log(`[messaging-service] message:send - Dispatching push notification via ${notifUrl}...`);
              await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
                userIds: [peerUserId],
                type: "new_message",
                title: senderName,
                body: preview,
                data: { conversationId, messageId: message.id, senderUserId: auth.userId, senderName, senderAvatarUrl },
              });
              console.log(`[messaging-service] message:send - Push notification dispatched successfully.`);
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
            message: err.message || getMessage("failedToSendMessage"),
            code: err.code || "INTERNAL_ERROR",
          });
        }
      }
    });

    // 7. Mark conversation read
    socket.on("message:read", async ({ conversationId } = {}, callback) => {
      try {
        if (!conversationId) throw new Error(getMessage("conversationIdRequired"));
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
            message: err.message || getMessage("failedToMarkConversationRead"),
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
    // 9. Block / unblock user
    socket.on("user:block", async ({ targetUserId } = {}, callback) => {
      try {
        if (!targetUserId) throw new Error(getMessage("conversationIdRequired"));
        const data = await svc.blockUser(auth, targetUserId);
        // Broadcast to both users that block status changed
        io.to(`user:${auth.userId}`).to(`user:${targetUserId}`).emit("user:blocked", {
          blockerUserId: auth.userId,
          blockedUserId: targetUserId,
        });
        if (typeof callback === "function") {
          callback({ success: true, data });
        }
      } catch (err) {
        console.error("[messaging-service] user:block error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "INTERNAL_ERROR" });
        }
      }
    });

    socket.on("user:unblock", async ({ targetUserId } = {}, callback) => {
      try {
        if (!targetUserId) throw new Error(getMessage("conversationIdRequired"));
        const data = await svc.unblockUser(auth, targetUserId);
        io.to(`user:${auth.userId}`).to(`user:${targetUserId}`).emit("user:unblocked", {
          blockerUserId: auth.userId,
          blockedUserId: targetUserId,
        });
        if (typeof callback === "function") {
          callback({ success: true, data });
        }
      } catch (err) {
        console.error("[messaging-service] user:unblock error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "INTERNAL_ERROR" });
        }
      }
    });

    // 10. Report conversation
    socket.on("conversation:report", async ({ conversationId, reason } = {}, callback) => {
      try {
        if (!conversationId) throw new Error(getMessage("conversationIdRequired"));
        if (!reason || typeof reason !== "string" || !reason.trim()) {
          throw new Error("Reason is required");
        }
        const data = await svc.reportConversation(auth, conversationId, reason.trim());
        if (typeof callback === "function") {
          callback({ success: true, data });
        }
      } catch (err) {
        console.error("[messaging-service] conversation:report error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "INTERNAL_ERROR" });
        }
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(
        `[messaging-service] User disconnected: ${auth.userId} (${socket.id}) - reason: ${reason}`
      );
    });
  });
}
