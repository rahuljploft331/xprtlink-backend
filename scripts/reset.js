#!/usr/bin/env node
/**
 * Reset backend seed data: clear local seed state (+ optional Mongo) then reseed.
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
import {
  clearSeedState,
  dropMongoSeedCollectionsIfConfigured,
  getStatePath,
  seedMongoIfConfigured,
  writeSeedState,
} from "../seeder/lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const noSeed = process.argv.includes("--no-seed");

async function main() {
  console.log("[reset] clearing local seed state…");
  clearSeedState();
  console.log(`[reset] cleared ${getStatePath()}`);

  const dropped = await dropMongoSeedCollectionsIfConfigured();
  if (dropped.skipped) {
    console.log(`[reset] mongo: skipped (${dropped.reason})`);
  } else {
    console.log(
      `[reset] mongo: dropped collections in db=${dropped.database}`
    );
  }

  if (noSeed) {
    console.log("[reset] wipe-only complete (--no-seed)");
    return;
  }

  console.log("[reset] reseeding…");
  const payload = buildSeedPayload();
  writeSeedState(payload);
  const mongo = await seedMongoIfConfigured(payload);
  if (mongo.skipped) {
    console.log(`[reset] mongo seed: skipped (${mongo.reason})`);
  } else {
    console.log(`[reset] mongo seed: db=${mongo.database}`);
  }

  console.log("[reset] done — backend seed restored to demo baseline");
  console.log("[reset] tip: pnpm pm2:restart  if services are running");
}

main().catch((err) => {
  console.error("[reset] failed:", err);
  process.exit(1);
});
