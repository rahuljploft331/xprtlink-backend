import express from "express";
import cors from "cors";
import helmet from "helmet";
import { disconnectDb, getDb } from "../db/getClient.js";
import { loadSecret } from "./secrets.js";


/**
 * Parse CORS_ORIGIN env var.
 * - "*"                  → true  (allow all — dev only)
 * - "a.com,b.com,..."    → string[] of trimmed origins
 * - single origin        → string
 */
function getCorsOriginValidator() {
  const raw = process.env.CORS_ORIGIN ?? "*";
  if (raw === "*") return true;

  const allowedOrigins = raw.split(",").map((o) => o.trim()).filter(Boolean);

  return (origin, callback) => {
    // Allow requests with no Origin header (mobile apps, curl, server-to-server, file://)
    if (!origin || origin === "null") {
      return callback(null, true);
    }

    // H8: Use an explicit CORS_ALLOW_ALL=true flag for local dev instead of
    // overloading NODE_ENV — a staging deployment that forgets NODE_ENV=production
    // would otherwise open full credentialed CORS access to any origin.
    if (process.env.CORS_ALLOW_ALL === "true") {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
      return callback(null, true);
    }
    callback(new Error(`CORS origin '${origin}' not allowed`));
  };
}

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: getCorsOriginValidator(),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
    })
  );

  // 1MB default — sufficient for all JSON API payloads.
  // media-service directUpload route overrides with 100mb locally for base64 uploads.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        service: process.env.SERVICE_NAME || "unknown",
        uptime: process.uptime(),
      },
    });
  });

  return app;
}

export async function startService(app, port, label = "Service", { useDatabase = true } = {}) {
  await loadSecret(); // Ensure secrets are fetched into memory synchronously for runtime modules

  if (useDatabase && process.env.DATABASE_URL) {
    getDb();
  }

  const shutdown = async () => {
    if (useDatabase) await disconnectDb();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[${label}] listening on :${port}`);
      if (useDatabase && process.env.DATABASE_URL) {
        console.log(`[${label}] database pool ready`);
      }
      resolve(server);
    });
  });
}
