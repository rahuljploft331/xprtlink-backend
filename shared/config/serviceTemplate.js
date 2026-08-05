import express from "express";
import cors from "cors";
import helmet from "helmet";
import { disconnectDb, getDb } from "../db/getClient.js";

/**
 * Shared Express app factory.
 */
export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN === "*" ? true : process.env.CORS_ORIGIN,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

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

export function startService(app, port, label = "Service", { useDatabase = true } = {}) {
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
