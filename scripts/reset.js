#!/usr/bin/env node
/**
 * Reset backend seed data: clear local seed state + PostgreSQL then reseed.
 *
 * Usage:
 *   pnpm reset
 *   pnpm reset -- --no-seed   # wipe only
 *
 * Safe for local/dev. Do not run against production without intent.
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { buildSeedPayload } from "../seeder/index.js";
import { closePostgres, resetPostgres, seedPostgres } from "../seeder/lib/pg.js";
import {
  clearSeedState,
  getStatePath,
  writeSeedState,
} from "../seeder/lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const noSeed = process.argv.includes("--no-seed");

async function main() {
  console.log("[reset] clearing local seed state…");
  clearSeedState();
  console.log(`[reset] cleared ${getStatePath()}`);

  if (!process.env.DATABASE_URL) {
    console.log("[reset] postgres: skipped (DATABASE_URL not set)");
  } else {
    console.log("[reset] truncating postgres tables…");
    await resetPostgres();
    console.log("[reset] postgres: truncated");
  }

  if (noSeed) {
    if (process.env.DATABASE_URL) await closePostgres();
    console.log("[reset] wipe-only complete (--no-seed)");
    return;
  }

  console.log("[reset] reseeding…");
  const payload = buildSeedPayload();
  writeSeedState(payload);

  if (process.env.DATABASE_URL) {
    const pg = await seedPostgres(payload);
    console.log(`[reset] postgres seed: ${JSON.stringify(pg.counts)}`);
    await closePostgres();
  } else {
    console.log("[reset] postgres seed: skipped (DATABASE_URL not set)");
  }

  console.log("[reset] done — backend seed restored to demo baseline");
  console.log("[reset] tip: pnpm pm2:restart  if services are running");
}

main().catch((err) => {
  console.error("[reset] failed:", err);
  process.exit(1);
});
