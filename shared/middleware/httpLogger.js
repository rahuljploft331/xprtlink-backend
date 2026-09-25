/**
 * HTTP request logging middleware (pino-http).
 *
 * Wired into every service via serviceTemplate.createApp(). Produces one
 * structured log line per request with method, url, status, and latency,
 * attributed to the owning service. Each request also gets `req.log`, a
 * request-scoped child logger controllers can use.
 */
import pinoHttp from "pino-http";
import { logger } from "../lib/logger.js";

/** Paths that should not generate a log line on every hit (health probes). */
const QUIET_PATHS = new Set(["/health", "/favicon.ico"]);

export const httpLogger = pinoHttp({
  logger,

  // Health checks are polled constantly by PM2 / load balancers — silence them.
  autoLogging: {
    ignore: (req) => QUIET_PATHS.has(req.url?.split("?")[0]),
  },

  // Reuse an inbound correlation id if the gateway/proxy set one.
  genReqId: (req, res) => {
    const existing = req.headers["x-request-id"];
    if (existing) return existing;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    res.setHeader("x-request-id", id);
    return id;
  },

  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },

  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} - ${err?.message ?? "error"}`,

  // req/res/err serializers are defined on the base logger (shared/lib/logger.js)
  // so they apply consistently across every child logger pino-http creates.
});

export default httpLogger;
