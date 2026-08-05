import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../.data");
const STATE_FILE = path.join(DATA_DIR, "seed-state.json");

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function writeSeedState(payload) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return STATE_FILE;
}

export function readSeedState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

export function clearSeedState() {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
  return STATE_FILE;
}

export function getStatePath() {
  return STATE_FILE;
}

/**
 * Optional Mongo wipe + insert when MONGODB_URI is set.
 * Uses raw collections (no shared models yet — DB still deferred).
 */
export async function seedMongoIfConfigured(payload) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return { skipped: true, reason: "MONGODB_URI not set — file seed only" };
  }

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const dbName = process.env.MONGODB_DB || undefined;
    const db = client.db(dbName);

    const map = {
      categories: payload.categories,
      admins: payload.admins,
      customers: payload.customers,
      experts: payload.experts,
      cms_pages: payload.cmsPages,
      subscription_plans: payload.subscriptionPlans,
      platform_config: [payload.platformConfig],
    };

    for (const [collection, docs] of Object.entries(map)) {
      await db.collection(collection).deleteMany({});
      if (docs?.length) {
        await db.collection(collection).insertMany(
          docs.map((doc) => ({ ...doc, _seededAt: payload.meta.seededAt }))
        );
      }
    }

    return {
      skipped: false,
      database: db.databaseName,
      collections: Object.keys(map),
    };
  } finally {
    await client.close();
  }
}

export async function dropMongoSeedCollectionsIfConfigured() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return { skipped: true, reason: "MONGODB_URI not set" };
  }

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || undefined);
    const names = [
      "categories",
      "admins",
      "customers",
      "experts",
      "cms_pages",
      "subscription_plans",
      "platform_config",
    ];
    for (const name of names) {
      try {
        await db.collection(name).drop();
      } catch {
        // collection may not exist
      }
    }
    return { skipped: false, database: db.databaseName, dropped: names };
  } finally {
    await client.close();
  }
}
