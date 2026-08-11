/**
 * Free local service ports (4000–4009) and stop orphaned dev processes.
 *
 * Usage:
 *   node scripts/kill-ports.js          # ports + nodemon orphans
 *   node scripts/kill-ports.js --pm2    # also stop PM2 ecosystem
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getServicePorts } from "../shared/config/loadEnv.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stopPm2 = process.argv.includes("--pm2");

function run(command, { ignoreErrors = true } = {}) {
  try {
    execSync(command, { cwd: backendRoot, stdio: "pipe", encoding: "utf8" });
    return true;
  } catch (error) {
    if (!ignoreErrors) throw error;
    return false;
  }
}

function getPidsOnPort(port) {
  try {
    const output = execSync(`ss -tlnp 'sport = :${port}'`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pids = new Set();
    for (const match of output.matchAll(/pid=(\d+)/g)) {
      pids.add(Number(match[1]));
    }
    return [...pids];
  } catch {
    try {
      const output = execSync(`lsof -ti :${port}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return output
        .split("\n")
        .map((line) => Number(line.trim()))
        .filter((pid) => Number.isFinite(pid) && pid > 0);
    } catch {
      return [];
    }
  }
}

function killPort(port) {
  const pids = getPidsOnPort(port);
  if (pids.length === 0) return false;

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // process may already be gone
    }
  }

  // fuser handles stubborn listeners when available
  run(`fuser -k ${port}/tcp`, { ignoreErrors: true });
  return true;
}

function stopPm2Ecosystem() {
  const stopped = run("npx pm2 stop ecosystem.config.cjs", { ignoreErrors: true });
  if (stopped) {
    console.log("[kill-ports] stopped PM2 ecosystem");
  }
}

function killOrphanDevProcesses() {
  const patterns = [
    "xpertlink-backend/.*nodemon",
    "xpertlink-backend/node_modules/.bin/../dotenv-cli/cli.js -e ../../.env -- nodemon",
  ];

  for (const pattern of patterns) {
    run(`pkill -f "${pattern}"`, { ignoreErrors: true });
  }
}

const entries = Object.entries(getServicePorts()).sort(([, a], [, b]) => a - b);

if (stopPm2) {
  stopPm2Ecosystem();
}

killOrphanDevProcesses();

let freed = 0;
for (const [service, port] of entries) {
  if (killPort(port)) {
    console.log(`[kill-ports] freed :${port} (${service})`);
    freed += 1;
  }
}

if (freed === 0) {
  console.log("[kill-ports] all service ports already free");
} else {
  console.log(`[kill-ports] freed ${freed} port(s)`);
}
