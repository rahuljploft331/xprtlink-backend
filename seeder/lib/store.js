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
