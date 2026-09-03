#!/usr/bin/env node
/**
 * Dump the remote (SSH) Postgres database and overwrite the local one.
 *
 * Usage:
 *   pnpm sync-remote-db
 *   pnpm sync-remote-db -- --no-local-backup
 *
 * Requires:
 *   - SSH host alias `xprtlink` (or SYNC_REMOTE_SSH)
 *   - Local DATABASE_URL in .env pointing at localhost
 *   - pg_dump / pg_restore / psql on PATH (PostgreSQL client tools)
 *
 * Remote credentials are read from the server's .env over SSH — they are
 * not stored in this repo.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

const skipLocalBackup = process.argv.includes("--no-local-backup");
const sshHost = process.env.SYNC_REMOTE_SSH || "xprtlink";
const remoteDir = process.env.SYNC_REMOTE_DIR || "/home/ubuntu/xprtlink-backend";
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

function log(message) {
  console.log(`[sync-remote-db] ${message}`);
}

function fail(message) {
  console.error(`[sync-remote-db] ${message}`);
  process.exit(1);
}

function resolveCmd(names, extraDirs = []) {
  const candidates = Array.isArray(names) ? names : [names];
  for (const name of candidates) {
    const lookup = spawnSync(process.platform === "win32" ? "where" : "which", [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (lookup.status === 0) {
      const found = lookup.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (found) return found;
    }
  }

  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    extraDirs.push(path.join(programFiles, "PostgreSQL", "18", "bin"));
    extraDirs.push(path.join(programFiles, "PostgreSQL", "16", "bin"));
    extraDirs.push(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "OpenSSH"));
  }

  for (const dir of extraDirs) {
    for (const name of candidates) {
      const exe = path.join(dir, process.platform === "win32" && !name.endsWith(".exe") ? `${name}.exe` : name);
      if (fs.existsSync(exe)) return exe;
    }
  }

  return null;
}

function run(bin, args, { input, env, cwd } = {}) {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    cwd: cwd || backendRoot,
    env: env || process.env,
    input,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`${path.basename(bin)} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result;
}

function parseDatabaseUrl(raw) {
  if (!raw) fail("DATABASE_URL is not set in local .env");
  const cleaned = raw.trim().split("?")[0];
  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    fail("DATABASE_URL is not a valid URL");
  }
  const maintenance = new URL(cleaned);
  maintenance.pathname = "/postgres";
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) fail("DATABASE_URL is missing a database name");
  return {
    href: cleaned,
    hostname: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    database,
    maintenanceHref: maintenance.href,
  };
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function redactUrl(url) {
  return url.replace(/\/\/([^:]+):[^@]+@/, "//$1:***@");
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

function sshBash(script) {
  const sshBin = resolveCmd("ssh");
  if (!sshBin) fail("ssh not found. Install OpenSSH or add ssh to PATH.");
  const result = spawnSync(
    sshBin,
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", sshHost, "tr -d '\\r' | bash"],
    {
      encoding: "utf8",
      input: script.replace(/\r\n/g, "\n"),
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    fail(`SSH to ${sshHost} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result.stdout || "";
}

function scpFromRemote(remotePath, localPath) {
  const scpBin = resolveCmd("scp");
  if (!scpBin) fail("scp not found. Install OpenSSH or add scp to PATH.");
  run(scpBin, ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", `${sshHost}:${remotePath}`, localPath]);
}

function pgEnv(db) {
  return {
    ...process.env,
    PGPASSWORD: db.password,
    PGSSLMODE: process.env.PGSSLMODE || "prefer",
  };
}

function main() {
  const local = parseDatabaseUrl(process.env.DATABASE_URL);
  if (!localHosts.has(local.hostname.toLowerCase())) {
    fail(
      `Refusing to overwrite non-local DATABASE_URL host "${local.hostname}". ` +
        "This command only writes to localhost / 127.0.0.1.",
    );
  }

  const psql = resolveCmd("psql");
  const pgDump = resolveCmd("pg_dump");
  const pgRestore = resolveCmd("pg_restore");
  if (!psql || !pgDump || !pgRestore) {
    fail("Need psql, pg_dump, and pg_restore on PATH (PostgreSQL client tools).");
  }

  const backupsDir = path.join(backendRoot, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const ts = stamp();

  log(`local target ${redactUrl(local.href)}`);
  log(`ssh ${sshHost}:${remoteDir}`);

  if (!skipLocalBackup) {
    const localBackup = path.join(backupsDir, `local_before_sync_${ts}.dump`);
    log(`backing up local database to ${localBackup}`);
    try {
      run(pgDump, [local.href, "-Fc", "--no-owner", "--no-acl", "-f", localBackup], { env: pgEnv(local) });
    } catch (error) {
      log(`local backup skipped (${error.message.split("\n")[0]})`);
    }
  }

  log("dumping remote database over SSH");
  const remoteDumpName = `xpertlink_remote_${ts}.dump`;
  const stdout = sshBash(`
set -eu
cd "${remoteDir}"
mkdir -p backups
URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | cut -d'?' -f1)
if [ -z "$URL" ]; then
  echo "ERROR: DATABASE_URL missing on remote .env" >&2
  exit 1
fi
DUMP="$PWD/backups/${remoteDumpName}"
pg_dump "$URL" -Fc --no-owner --no-acl -f "$DUMP"
echo "REMOTE_DUMP=$DUMP"
`);
  const remoteDumpLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("REMOTE_DUMP="));
  if (!remoteDumpLine) fail(`remote dump did not report a file path. Output:\n${stdout}`);
  const remoteDumpPath = remoteDumpLine.slice("REMOTE_DUMP=".length);
  log(`remote dump ${remoteDumpPath}`);

  const localDump = path.join(backupsDir, remoteDumpName);
  log(`downloading dump to ${localDump}`);
  scpFromRemote(remoteDumpPath, localDump);

  const dumpBytes = fs.statSync(localDump).size;
  if (dumpBytes < 1024) fail(`downloaded dump is too small (${dumpBytes} bytes)`);
  log(`downloaded ${(dumpBytes / 1024).toFixed(1)} KB`);

  log(`recreating local database ${local.database}`);
  const adminArgs = [local.maintenanceHref, "-v", "ON_ERROR_STOP=1"];
  run(
    psql,
    [
      ...adminArgs,
      "-c",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteLiteral(local.database)} AND pid <> pg_backend_pid();`,
    ],
    { env: pgEnv(local) },
  );
  run(psql, [...adminArgs, "-c", `DROP DATABASE IF EXISTS ${quoteIdent(local.database)} WITH (FORCE);`], {
    env: pgEnv(local),
  });
  run(
    psql,
    [
      ...adminArgs,
      "-c",
      `CREATE DATABASE ${quoteIdent(local.database)}${local.user ? ` OWNER ${quoteIdent(local.user)}` : ""};`,
    ],
    { env: pgEnv(local) },
  );

  log("restoring remote dump into local database");
  run(pgRestore, ["--no-owner", "--no-acl", "--exit-on-error", "-d", local.href, localDump], {
    env: pgEnv(local),
  });

  const count = run(psql, [
    local.href,
    "-tAc",
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';",
  ], { env: pgEnv(local) });
  log(`done. local ${local.database} now has ${String(count.stdout).trim()} public tables`);
  log(`dump kept at ${localDump}`);
  log("restart local services if they are running: pnpm pm2:restart");
}

try {
  main();
} catch (error) {
  fail(error.message || String(error));
}
