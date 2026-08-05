#!/usr/bin/env node
/**
 * Seed local demo data.
 * Always writes seeder/.data/seed-state.json
 * Also upserts Mongo collections when MONGODB_URI is set.
 *
 * Usage: pnpm seed
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { buildSeedPayload } from "../seeder/index.js";
import {
  getStatePath,
  seedMongoIfConfigured,
  writeSeedState,
} from "../seeder/lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const payload = buildSeedPayload();
  const filePath = writeSeedState(payload);
  console.log(`[seed] wrote file store → ${filePath}`);
  console.log(
    `[seed] counts: admins=${payload.admins.length}, customers=${payload.customers.length}, experts=${payload.experts.length}, categories=${payload.categories.length}`
  );

  const mongo = await seedMongoIfConfigured(payload);
  if (mongo.skipped) {
    console.log(`[seed] mongo: skipped (${mongo.reason})`);
  } else {
    console.log(
      `[seed] mongo: seeded db=${mongo.database} collections=${mongo.collections.join(", ")}`
    );
  }

  console.log("[seed] done");
  console.log(`[seed] state path: ${getStatePath()}`);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
