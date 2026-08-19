import { verifyAccessToken } from "@xprtlink/shared/auth/jwt.js";
import * as svc from "../services/supportChatService.js";

/**
 * Register Socket.IO authentication and event listeners for the `/support` namespace.
 * @param {import("socket.io").Server} io
 */
export function registerSupportSockets(io) {
  const supportNamespace = io.of("/support");

  // Handshake authentication middleware
  supportNamespace.use((socket, next) => {
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

  supportNamespace.on("connection", (socket) => {
    const auth = socket.data.auth;
    const isAdmin = ["super_admin", "subadmin"].includes(auth.role);
    
    // Join personal room based on role (for targeted broadcasts)
    const personalRoom = isAdmin ? `support-admin:${auth.userId}` : `support-user:${auth.userId}`;
    socket.join(personalRoom);

    console.log(
      `[messaging-service/support] ${isAdmin ? "Admin" : "User"} connected: ${auth.userId} -> socket ${socket.id}`
    );

    // ─── USER EVENTS ─────────────────────────────────────────────────────────────
    
    // 1. User connects to support chat
    socket.on("support:connect", async (payload = {}, callback) => {
      if (isAdmin) return;
      try {
        const conversation = await svc.getOrCreateSupportConversation(auth.userId);
        const conversationRoom = `support-conversation:${conversation.id}`;
        socket.join(conversationRoom);

        // Fetch recent messages
        const messagesData = await svc.listSupportMessages(conversation.id, { limit: 50, page: 1 }, auth);

        if (typeof callback === "function") {
          callback({ success: true, data: { conversation, messages: messagesData } });
        }
      } catch (err) {
        console.error("[messaging-service/support] support:connect error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "INTERNAL_ERROR" });
        }
      }
    });

    // 1b. User creates a new support chat explicitly
    socket.on("support:ticket:create", async (payload = {}, callback) => {
      if (isAdmin) return;
      try {
        const conversation = await svc.createNewSupportConversation(auth.userId);
        const conversationRoom = `support-conversation:${conversation.id}`;
        socket.join(conversationRoom);

        // Fetch recent messages (will be empty)
        const messagesData = await svc.listSupportMessages(conversation.id, { limit: 50, page: 1 }, auth);

        // Broadcast to admins that a new ticket appeared
        supportNamespace.emit("support:list:refresh");

        if (typeof callback === "function") {
          callback({ success: true, data: { conversation, messages: messagesData } });
        }
      } catch (err) {
        console.error("[messaging-service/support] support:ticket:create error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "INTERNAL_ERROR" });
        }
      }
    });

    // ─── ADMIN EVENTS ────────────────────────────────────────────────────────────

    // 2. Admin lists open conversations
    socket.on("support:list", async (payload = {}, callback) => {
      if (!isAdmin) return;
      try {
        const data = await svc.listSupportConversations(auth, payload);
        if (typeof callback === "function") {
          callback({ success: true, data });
        }
      } catch (err) {
        console.error("[messaging-service/support] support:list error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "INTERNAL_ERROR" });
        }
      }
    });

    // 3. Admin joins a specific conversation
    socket.on("support:join", async (payload = {}, callback) => {
      if (!isAdmin) return;
      try {
        if (!payload.conversationId) throw new Error("conversationId is required");
        const conversationId = payload.conversationId;
        
        await svc.assignSupportConversation(conversationId, auth);
        const conversationRoom = `support-conversation:${conversationId}`;
        socket.join(conversationRoom);

        // Fetch recent messages
        const messagesData = await svc.listSupportMessages(conversationId, { limit: 50, page: 1 }, auth);
        const conversation = await svc.getSupportConversation(conversationId, auth);

        // Notify user that an admin joined
        supportNamespace.to(`support-user:${conversation.userId}`).emit("support:conversation:assigned", {
          conversationId,
          adminName: conversation.adminName,
        });

        // Broadcast refresh to other admins so it disappears from their "open" lists
        supportNamespace.to("support-admin:*").emit("support:list:refresh"); // Using a general room broadcast requires joining. We'll just emit globally.
        supportNamespace.emit("support:list:refresh");

        if (typeof callback === "function") {
          callback({ success: true, data: { conversation, messages: messagesData, joined: true } });
        }
      } catch (err) {
        console.error("[messaging-service/support] support:join error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "FORBIDDEN" });
        }
      }
    });

    // 4. Admin leaves a conversation
    socket.on("support:leave", async (payload = {}, callback) => {
      if (!isAdmin) return;
      try {
        if (payload.conversationId) {
          await svc.unassignSupportConversation(payload.conversationId, auth);
          socket.leave(`support-conversation:${payload.conversationId}`);
          supportNamespace.emit("support:list:refresh");
        }
        if (typeof callback === "function") {
          callback({ success: true, data: { conversationId: payload.conversationId, left: true } });
        }
      } catch (err) {
        console.error("[messaging-service/support] support:leave error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "INTERNAL_ERROR" });
        }
      }
    });
    
    // 5. Admin resolves a conversation
    socket.on("support:resolve", async (payload = {}, callback) => {
      if (!isAdmin) return;
      try {
        if (!payload.conversationId) throw new Error("conversationId is required");
        await svc.resolveSupportConversation(payload.conversationId, auth);
        
        const conversation = await svc.getSupportConversation(payload.conversationId, auth);
        
        // Notify user
        supportNamespace.to(`support-user:${conversation.userId}`).emit("support:conversation:resolved", {
          conversationId: payload.conversationId,
        });
        
        if (typeof callback === "function") {
          callback({ success: true });
        }
      } catch (err) {
        console.error("[messaging-service/support] support:resolve error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "INTERNAL_ERROR" });
        }
      }
    });

    // ─── SHARED EVENTS ───────────────────────────────────────────────────────────

    // 6. Fetch paginated message history
    socket.on("support:message:history", async (payload = {}, callback) => {
      try {
        const { conversationId, ...query } = payload;
        if (!conversationId) throw new Error("conversationId is required");
        
        const data = await svc.listSupportMessages(conversationId, query, auth);
        if (typeof callback === "function") {
          callback({ success: true, data });
        }
      } catch (err) {
        console.error("[messaging-service/support] support:message:history error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "INTERNAL_ERROR" });
        }
      }
    });

    // 7. Send a message
    socket.on("support:message:send", async (payload = {}, callback) => {
      try {
        const { conversationId, body } = payload;
        if (!conversationId) throw new Error("conversationId is required");
        
        const message = await svc.sendSupportMessage(conversationId, { body }, auth);
        const conversationRoom = `support-conversation:${conversationId}`;
        
        // Broadcast to conversation room
        supportNamespace.to(conversationRoom).emit("support:message:new", {
          conversationId,
          message,
        });

        // Also broadcast to admin room directly (if sent by user) or user room (if sent by admin)
        // This is useful if the peer hasn't explicitly joined the room yet
        const conversation = await svc.getSupportConversation(conversationId, auth);
        if (isAdmin) {
          supportNamespace.to(`support-user:${conversation.userId}`).emit("support:message:new", { conversationId, message });
        } else if (conversation.adminUserId) {
          supportNamespace.to(`support-admin:${conversation.adminUserId}`).emit("support:message:new", { conversationId, message });
        }
        
        // Trigger generic dashboard update for all admins if sent by user
        if (!isAdmin) {
          supportNamespace.emit("support:list:refresh");
        }

        if (typeof callback === "function") {
          callback({ success: true, data: message });
        }
      } catch (err) {
        console.error("[messaging-service/support] support:message:send error:", err.message);
        if (typeof callback === "function") {
          callback({ success: false, message: err.message, code: err.code || "INTERNAL_ERROR" });
        }
      }
    });

    // 8. Typing indicators
    socket.on("support:typing:start", ({ conversationId } = {}) => {
      if (conversationId) {
        socket.to(`support-conversation:${conversationId}`).emit("support:typing", {
          conversationId,
          userId: auth.userId,
          isTyping: true,
          senderRole: isAdmin ? "admin" : "user",
        });
      }
    });

    socket.on("support:typing:stop", ({ conversationId } = {}) => {
      if (conversationId) {
        socket.to(`support-conversation:${conversationId}`).emit("support:typing", {
          conversationId,
          userId: auth.userId,
          isTyping: false,
          senderRole: isAdmin ? "admin" : "user",
        });
      }
    });

    socket.on("disconnect", async (reason) => {
      console.log(
        `[messaging-service/support] ${isAdmin ? "Admin" : "User"} disconnected: ${auth.userId} (${socket.id}) - reason: ${reason}`
      );
      if (isAdmin) {
        try {
          await svc.releaseAdminConversations(auth.userId);
          supportNamespace.emit("support:list:refresh");
        } catch (err) {
          console.error("[messaging-service/support] release on disconnect error:", err.message);
        }
      }
    });
  });
}
