/**
 * Centralised structured logger for all XprtLink backend services.
 *
 * Built on Pino (fast, structured JSON, ESM-friendly). One logger instance
 * per service process, tagged with `service` so multi-service log files stay
 * attributable.
 *
 * Outputs (all fan out from a single logger):
 *   1. stdout          — pretty in development, raw JSON in production.
 *                        PM2 captures this into logs/<service>-out.log.
 *   2. <service>-app.log   — persistent JSON, ALL levels >= LOG_LEVEL.
 *   3. <service>-audit.log — persistent JSON, audit events only
 *                            (emitted via `logger.audit(...)`), for later review.
 *
 * The app + audit files live in the repo `logs/` folder (gitignored) and are
 * intentionally separate from PM2's -out/-error files so they survive
 * `pm2 flush` and can be shipped/rotated independently.
 *
 * Usage:
 *   import { logger } from "@xprtlink/shared/lib/logger.js";
 *   logger.info({ userId }, "user logged in");
 *   logger.error({ err }, "failed to charge card");
 *   logger.audit("payment.captured", { consultationId, amount });   // → audit file
 *   const log = logger.child({ module: "engagementService" });      // scoped
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";

const __dirname = dirname(fileURLToPath(import.meta.url));

// shared/lib -> shared -> xpertlink-backend/logs
const LOG_DIR = resolve(__dirname, "..", "..", "logs");

// Allow an explicit override (useful for tests / non-standard deployments).
const resolvedLogDir = process.env.LOG_DIR ? resolve(process.env.LOG_DIR) : LOG_DIR;

const SERVICE_NAME = process.env.SERVICE_NAME || "backend";
const NODE_ENV = process.env.NODE_ENV || "development";
const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === "production" ? "info" : "debug");
const IS_PROD = NODE_ENV === "production";

// A discrete level number pino uses to tag audit records so we can route them
// to their own file and still see them in the main stream. Named distinctly
// from the public `logger.audit()` helper to avoid shadowing pino's generated
// level method.
const AUDIT_LEVEL = "auditlog";

// Ensure the log directory exists before pino opens file destinations.
try {
  mkdirSync(resolvedLogDir, { recursive: true });
} catch {
  // If we cannot create the dir (read-only FS, etc.) pino file targets will
  // no-op-fail; stdout logging still works. Do not crash the service on boot.
}

const appLogFile = join(resolvedLogDir, `${SERVICE_NAME}-app.log`);
const auditLogFile = join(resolvedLogDir, `${SERVICE_NAME}-audit.log`);

/**
 * stdout target: pretty in dev, raw JSON in prod.
 * PM2 already captures stdout to logs/<service>-out.log, so we do not add a
 * second plain-stdout file target.
 */
const stdoutTarget = IS_PROD
  ? { target: "pino/file", level: LOG_LEVEL, options: { destination: 1 } }
  : {
      target: "pino-pretty",
      level: LOG_LEVEL,
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l o",
        ignore: "pid,hostname",
        messageFormat: "[{service}] {msg}",
      },
    };

const targets = [
  stdoutTarget,
  // Persistent app log — every record at/above LOG_LEVEL, JSON, for audit/debug.
  {
    target: "pino/file",
    level: LOG_LEVEL,
    options: { destination: appLogFile, mkdir: true },
  },
  // Dedicated audit log — only records at the custom `audit` level and above.
  {
    target: "pino/file",
    level: AUDIT_LEVEL,
    options: { destination: auditLogFile, mkdir: true },
  },
];

const baseLogger = pino(
  {
    level: LOG_LEVEL,
    // Register the custom audit level just above `error` so it is never
    // filtered out and lands in the audit file.
    customLevels: { [AUDIT_LEVEL]: 55 },
    base: { service: SERVICE_NAME, env: NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    // NOTE: a custom `formatters.level` cannot be used together with pino
    // transports (it is a function and cannot be passed to the worker thread —
    // doing so silently crashes the transport worker). We therefore keep pino's
    // default numeric levels in the JSON files (info=30, warn=40, error=50,
    // auditlog=55). `pino-pretty` still renders readable level names on stdout.
    // Compact serializers for HTTP request/response objects (pino-http passes
    // `req`/`res`). Without these, whole Node request objects get dumped.
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
      err: pino.stdSerializers.err,
    },
    redact: {
      // Never write secrets/PII to disk.
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "headers.authorization",
        "password",
        "*.password",
        "token",
        "*.token",
        "accessToken",
        "refreshToken",
        "otp",
        "*.otp",
      ],
      censor: "[REDACTED]",
    },
  },
  // `levels` must be passed to the transport too, otherwise the worker thread
  // does not recognise the custom `auditlog` level used as a target `level`
  // and silently fails to start (taking all file/stdout targets down with it).
  pino.transport({ targets, levels: { [AUDIT_LEVEL]: 55 } })
);

/**
 * Emit a structured audit event to the dedicated audit log (and stdout/app log).
 * Use for security- and money-sensitive actions worth reviewing later:
 * payments, payouts, verification decisions, admin/RBAC changes, auth events.
 *
 * @param {string} action  dotted event name, e.g. "payment.captured"
 * @param {object} [details] structured context (ids, amounts, actor)
 */
function audit(action, details = {}) {
  baseLogger[AUDIT_LEVEL]({ audit: true, action, ...details }, action);
}

// Attach audit() to the base logger and to any child loggers.
baseLogger.audit = audit;

const originalChild = baseLogger.child.bind(baseLogger);
function childWithAudit(bindings, options) {
  // IMPORTANT: forward `options` (serializers, level, redact) unchanged —
  // pino-http relies on child({}, { serializers }) to attach its req/res
  // serializers. Dropping options here caused raw request objects to be
  // logged in full.
  const child = originalChild(bindings, options);
  child.audit = audit;
  child.child = childWithAudit;
  return child;
}
baseLogger.child = childWithAudit;

export const logger = baseLogger;

/**
 * Convenience factory for a module-scoped child logger.
 *   const log = createLogger("engagementService");
 *   log.info("quote created");
 */
export function createLogger(moduleName, bindings = {}) {
  return baseLogger.child({ module: moduleName, ...bindings });
}

export default logger;
