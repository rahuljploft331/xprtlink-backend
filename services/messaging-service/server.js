import { Server } from "socket.io";
import { getConfig } from "@xprtlink/shared/config/loadEnv.js";
import { createApp, startService } from "@xprtlink/shared/config/serviceTemplate.js";
import { errorHandler, notFoundHandler } from "@xprtlink/shared/middleware/errorHandler.js";
import { registerMessagingSockets } from "./src/sockets/messagingSocket.js";
import { registerSupportSockets } from "./src/sockets/supportSocket.js";

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

// Initialize Socket.IO attached to HTTP server
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// 3. Register namespaces
registerMessagingSockets(io);
registerSupportSockets(io);
