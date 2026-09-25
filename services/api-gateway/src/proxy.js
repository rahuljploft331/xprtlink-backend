import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import { getConfig } from "@xprtlink/shared/config/loadEnv.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "proxy" });


export function createSocketProxy() {
  const { serviceUrls } = getConfig("api-gateway");
  return createProxyMiddleware({
    target: serviceUrls.messaging,
    changeOrigin: true,
    ws: true,
    pathFilter: "/socket.io",
    on: {
      error(err, _req, res) {
        log.error({ err: err.message }, "[gateway] socket proxy error:");
        if (res.writeHead) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              message: getMessage("messagingServiceUnavailable"),
              code: "BAD_GATEWAY",
            })
          );
        }
      },
    },
  });
}

/**
 * Webhook routes must reach the service byte-for-byte: signature checks (Stripe)
 * hash the raw body, and `fixRequestBody` re-serialises the parsed JSON, which
 * changes whitespace. createApp's JSON parser stashes the bytes on req.rawBody.
 */
function forwardRequestBody(proxyReq, req) {
  // changeOrigin rewrites Host to the service's address. Billing builds Stripe
  // return URLs from the public host, so pass it on — for billing only, taken
  // from the Host that reached the gateway (never a client-supplied
  // X-Forwarded-Host), with the scheme limited to http/https.
  if (req.originalUrl?.startsWith("/api/v1/billing")) {
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "").split(",")[0].trim();
    proxyReq.setHeader("x-forwarded-host", req.headers.host || "");
    proxyReq.setHeader("x-forwarded-proto", proto === "http" ? "http" : "https");
  }

  if (req.rawBody) {
    proxyReq.setHeader("Content-Length", req.rawBody.length);
    proxyReq.write(req.rawBody);
    return;
  }
  fixRequestBody(proxyReq, req);
}

/**
 * Proxy /api/v1/<domain>/* to downstream microservices.
 * Each service mounts the same path prefix internally.
 */
export function createGatewayProxies() {
  const { serviceUrls } = getConfig("api-gateway");

  const routes = [
    { path: "/api/v1/auth", target: serviceUrls.user },
    { path: "/api/v1/users", target: serviceUrls.user },
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
        proxyReq: forwardRequestBody,
        error(err, _req, res) {
          log.error({ err: err.message }, `[gateway] proxy error ${path}:`);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, message: getMessage("serviceUnavailable"), code: "BAD_GATEWAY" }));
        },
      },
    })
  );
}
