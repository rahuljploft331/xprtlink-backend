import { getConfig } from "@xprtlink/shared/config/loadEnv.js";
import { createApp, startService } from "@xprtlink/shared/config/serviceTemplate.js";
import { errorHandler, notFoundHandler } from "@xprtlink/shared/middleware/errorHandler.js";
import { defaultRateLimiter, authRateLimiter } from "@xprtlink/shared/middleware/rateLimiter.js";
import routes, { mountGatewayProxies } from "./src/routes/index.js";

const config = getConfig("api-gateway");
const app = createApp();

// Apply strict rate limiting on auth endpoints
app.use("/api/v1/auth", authRateLimiter);

// Apply global rate limiter
app.use(defaultRateLimiter);

mountGatewayProxies(app);
app.use("/api", routes);
app.use(notFoundHandler);
app.use(errorHandler);


const PORT = config.port;
const server = await startService(app, PORT, "API Gateway", { useDatabase: false });
server.setMaxListeners(25);


