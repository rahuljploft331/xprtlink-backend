import { getConfig } from "@xprtlink/shared/config/loadEnv.js";
import { createApp, startService } from "@xprtlink/shared/config/serviceTemplate.js";
import { errorHandler, notFoundHandler } from "@xprtlink/shared/middleware/errorHandler.js";
import { defaultRateLimiter, authRateLimiter, otpRateLimiter, passwordRateLimiter } from "@xprtlink/shared/middleware/rateLimiter.js";
import routes, { mountGatewayProxies } from "./src/routes/index.js";
import { createSocketProxy } from "./src/proxy.js";

const config = getConfig("api-gateway");
const app = createApp();

// Mount WebSocket proxy for Socket.IO polling / HTTP requests
const socketProxy = createSocketProxy();
app.use(socketProxy);

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// Order matters: more specific paths first, generic paths last.

// OTP send / resend — triggers real emails/SMS: ultra-strict (5/hour/IP)
app.use("/api/v1/auth/otp/send", otpRateLimiter);
app.use("/api/v1/auth/otp/resend", otpRateLimiter);

// Password reset / forgot — (5/15min/IP)
app.use("/api/v1/auth/password/forgot", passwordRateLimiter);
app.use("/api/v1/auth/password/reset", passwordRateLimiter);

// All other auth routes — login, register, refresh (10/15min/IP)
app.use("/api/v1/auth", authRateLimiter);

// Global fallback for all other API routes (100/15min/IP)
app.use(defaultRateLimiter);

mountGatewayProxies(app);
app.use("/api", routes);
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = config.port;
const server = await startService(app, PORT, "API Gateway", { useDatabase: false });
server.setMaxListeners(25);

// Forward WebSocket upgrade requests to messaging service
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/socket.io")) {
    socketProxy.upgrade(req, socket, head);
  }
});



