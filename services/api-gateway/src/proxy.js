import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import { getConfig } from "@xprtlink/shared/config/loadEnv.js";

export function createSocketProxy() {
  const { serviceUrls } = getConfig("api-gateway");
  return createProxyMiddleware({
    target: serviceUrls.messaging,
    changeOrigin: true,
    ws: true,
    pathFilter: "/socket.io",
    on: {
      error(err, _req, res) {
        console.error("[gateway] socket proxy error:", err.message);
        if (res.writeHead) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              message: "Messaging service unavailable",
              code: "BAD_GATEWAY",
            })
          );
        }
      },
    },
  });
}

/**
 * Proxy /api/v1/<domain>/* to downstream microservices.
 * Each service mounts the same path prefix internally.
 */
export function createGatewayProxies() {
  const { serviceUrls } = getConfig("api-gateway");

  const routes = [
    { path: "/api/v1/auth", target: serviceUrls.user },
    { path: "/api/v1/customers", target: serviceUrls.user },
    { path: "/api/v1/experts", target: serviceUrls.expert },
    { path: "/api/v1/search", target: serviceUrls.expert },
    { path: "/api/v1/catalog", target: serviceUrls.catalog },
    { path: "/api/v1/engagement", target: serviceUrls.engagement },
    { path: "/api/v1/billing", target: serviceUrls.billing },
    { path: "/api/v1/notifications", target: serviceUrls.notification },
    { path: "/api/v1/media", target: serviceUrls.media },
    { path: "/api/v1/admin", target: serviceUrls.admin },
  ];

  return routes.map(({ path, target }) =>
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathFilter: path,
      on: {
        proxyReq: fixRequestBody,
        error(err, _req, res) {
          console.error(`[gateway] proxy error ${path}:`, err.message);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, message: "Service unavailable", code: "BAD_GATEWAY" }));
        },
      },
    })
  );
}
