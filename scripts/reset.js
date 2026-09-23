#!/usr/bin/env node
/**
 * Reset backend data: clear local seed state + PostgreSQL then reseed.
 *
 * Usage:
 *   pnpm reset              # wipe ALL + reseed everything (platform + demo data)
 *   pnpm reset -- --no-seed  # wipe ALL + reseed platform essentials only
 *                             (admins, subscription plans, categories,
 *                              platform settings, CMS pages, app config)
 *
 * Platform essentials are ALWAYS restored so the admin portal remains
 * functional after a reset.
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { buildSeedPayload } from "../seeder/index.js";
import {
  closePostgres,
  resetPostgres,
  seedPostgres,
  seedPlatformEssentials,
} from "../seeder/lib/pg.js";
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
    return;
  }

  console.log("[reset] truncating postgres tables…");
  await resetPostgres();
  console.log("[reset] postgres: truncated");

  const payload = buildSeedPayload();

  if (noSeed) {
    // --no-seed: restore only platform essentials (no demo customers/experts/etc.)
    console.log("[reset] seeding platform essentials only (--no-seed)…");
    await seedPlatformEssentials(payload);
    await closePostgres();
    console.log("[reset] done — platform essentials restored (admins, plans, categories, settings, CMS)");
    console.log("[reset] no demo data seeded (customers, experts, consultations, quotes)");
    console.log("[reset] tip: pnpm pm2:restart  if services are running");
    return;
  }

  console.log("[reset] reseeding everything (platform + demo data)…");
  writeSeedState(payload);
  const pg = await seedPostgres(payload);
  console.log(`[reset] postgres seed: ${JSON.stringify(pg.counts)}`);
  await closePostgres();

  console.log("[reset] done — backend seed restored to demo baseline");
  console.log("[reset] tip: pnpm pm2:restart  if services are running");
}

main().catch((err) => {
  console.error("[reset] failed:", err);
  process.exit(1);
});
