#!/usr/bin/env node
/**
 * Seed local demo data.
 * Writes seeder/.data/seed-state.json and upserts PostgreSQL when DATABASE_URL is set.
 *
 * Usage: pnpm seed
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { buildSeedPayload } from "../seeder/index.js";
import { closePostgres, seedPostgres } from "../seeder/lib/pg.js";
import { getStatePath, writeSeedState } from "../seeder/lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const payload = buildSeedPayload();
  const filePath = writeSeedState(payload);
  console.log(`[seed] wrote file store → ${filePath}`);
  console.log(
    `[seed] counts: admins=${payload.admins.length}, customers=${payload.customers.length}, experts=${payload.experts.length}, categories=${payload.categories.length}`
  );

  if (!process.env.DATABASE_URL) {
    console.log("[seed] postgres: skipped (DATABASE_URL not set — file seed only)");
    console.log("[seed] done");
    console.log(`[seed] state path: ${getStatePath()}`);
    return;
  }

  const pg = await seedPostgres(payload);
  console.log(`[seed] postgres: seeded ${JSON.stringify(pg.counts)}`);
  await closePostgres();

  console.log("[seed] done");
  console.log(`[seed] state path: ${getStatePath()}`);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
