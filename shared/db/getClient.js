import { PrismaClient } from "../generated/prisma/index.js";

/** @type {PrismaClient | null} */
let client = null;

/**
 * Returns a Prisma client for this process (own connection pool).
 * Each PM2 service process should call this once on boot.
 */
export function getDb() {
  if (!client) {
    client = new PrismaClient({
      log:
        process.env.NODE_ENV === "development"
          ? ["warn", "error"]
          : ["error"],
    });
  }
  return client;
}

/** Graceful shutdown — call on SIGTERM/SIGINT. */
export async function disconnectDb() {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
