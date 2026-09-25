import { Server } from "socket.io";
import { getConfig } from "@xprtlink/shared/config/loadEnv.js";
import { createApp, startService } from "@xprtlink/shared/config/serviceTemplate.js";
import { errorHandler, notFoundHandler } from "@xprtlink/shared/middleware/errorHandler.js";
import { registerMessagingSockets } from "./src/sockets/messagingSocket.js";

import routes from "./src/routes/index.js";

const config = getConfig("messaging-service");
const app = createApp();

// All chat messaging is handled exclusively over WebSocket (Socket.IO).
// /api route provides service status, /health provides health probe.
app.use("/api", routes);
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = config.port;
const server = await startService(app, PORT, "Messaging Service");

// Resolve allowed CORS origins from env var (comma-separated).
// Falls back to '*' only in non-production so dev stays frictionless.
const corsOriginEnv = process.env.CORS_ORIGIN;
const socketCorsOrigin = corsOriginEnv
  ? corsOriginEnv.split(",").map((o) => o.trim()).filter(Boolean)
  : "*";

// Initialize Socket.IO attached to HTTP server
const io = new Server(server, {
  cors: {
    origin: socketCorsOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// 3. Register namespaces
registerMessagingSockets(io);
