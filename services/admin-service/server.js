import { getConfig } from "@xprtlink/shared/config/loadEnv.js";
import { createApp, startService } from "@xprtlink/shared/config/serviceTemplate.js";
import { errorHandler, notFoundHandler } from "@xprtlink/shared/middleware/errorHandler.js";
import routes from "./src/routes/index.js";
import { startPoller, stopPoller } from "./src/utils/ssePoller.js";

const config = getConfig("admin-service");
const app = createApp();

app.use("/api/v1/admin", routes);
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = config.port;
await startService(app, PORT, "Admin Service");

// Start SSE polling loop — detects new DB rows and broadcasts to connected admin tabs
startPoller();

// Graceful shutdown — stop the poller before process exit
process.on("SIGTERM", stopPoller);
process.on("SIGINT", stopPoller);
