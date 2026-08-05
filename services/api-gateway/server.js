import { getConfig } from "@xprtlink/shared/config/loadEnv.js";
import { createApp, startService } from "@xprtlink/shared/config/serviceTemplate.js";
import { errorHandler, notFoundHandler } from "@xprtlink/shared/middleware/errorHandler.js";
import routes, { mountGatewayProxies } from "./src/routes/index.js";

const config = getConfig("api-gateway");
const app = createApp();

mountGatewayProxies(app);
app.use("/api", routes);
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = config.port;
await startService(app, PORT, "API Gateway", { useDatabase: false });
