#!/usr/bin/env node
/**
 * init-flows.js — API-Driven Init Script
 *
 * Replaces the static dummy-data seeder with real API-driven initialization
 * by running verified Postman flow collections via Newman CLI runner.
 *
 * What it does:
 *   1. Optionally resets the database (--fresh flag)
 *   2. Seeds only system prerequisites (categories, plans, admins) via DB
 *   3. Health-checks the running API gateway
 *   3. Runs 6 verified Postman flow collections sequentially via Newman:
 *      A. Expert Onboarding Flow (phone OTP)
 *      B. Email Expert Onboarding Flow
 *      C. Customer Onboarding & Quote Flow
 *      D. Expert Subscription Lifecycle Flow (13 steps)
 *      E. Expert Verification Approval Flow
 *      F. Consultation Lifecycle Flow (12 steps)
 *      (Messaging is WebSocket/Socket.IO — tested separately, not via Newman)
 *   5. Prints a final pass/fail summary table
 *
 * Usage:
 *   pnpm init:flows               # seed platform prereqs + run all flows
 *   pnpm init:flows --fresh       # wipe DB first, then seed + run flows
 *   pnpm init:flows --flow A      # run only flow A (A|B|C|D|E|F|G)
 *   pnpm init:flows --no-seed     # skip platform seed, just run flows
 *
 * Requirements:
 *   - Backend services must be running (pm2 start / pnpm dev)
 *   - DATABASE_URL must be set in .env
 *   - newman must be installed (installed automatically if missing)
 */

import path from "path";
import { fileURLToPath } from "url";
import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = `http://localhost:${process.env.API_GATEWAY_PORT || 4000}`;
const FLOWS_DIR = path.resolve(__dirname, "flows");

const FLOWS = [
  {
    id: "A",
    label: "Expert Onboarding (Phone OTP)",
    file: path.join(FLOWS_DIR, "expert-onboarding-phone.flow.json"),
    collection: "XpertLink Automated Expert Onboarding Flow (Verified)",
  },
  {
    id: "B",
    label: "Email Expert Onboarding",
    file: path.join(FLOWS_DIR, "expert-onboarding-email.flow.json"),
    collection: "XpertLink Automated Email Expert Onboarding Flow (Verified)",
  },
  {
    id: "C",
    label: "Customer Onboarding & Quote Flow",
    file: path.join(FLOWS_DIR, "customer-onboarding.flow.json"),
    collection: "XpertLink Automated Customer Onboarding & Flow (Verified)",
  },
  {
    id: "D",
    label: "Expert Subscription Lifecycle (13 steps)",
    file: path.join(FLOWS_DIR, "expert-subscription-lifecycle.flow.json"),
    collection: "XpertLink Expert Subscription Flow (Verified)",
  },
  {
    id: "E",
    label: "Expert Verification Approval",
    file: path.join(FLOWS_DIR, "expert-verification-approval.flow.json"),
    collection: "XpertLink Expert Verification Approval Flow (Verified)",
  },
  {
    id: "F",
    label: "Consultation Lifecycle (12 steps)",
    file: path.join(FLOWS_DIR, "consultation-lifecycle.flow.json"),
    collection: "XpertLink Consultation Lifecycle Flow (Verified)",
  },
  // Flow G (Messaging Chat) is intentionally excluded:
  // All chat is handled over WebSocket (Socket.IO). REST endpoints for
  // conversations/messages do not exist — use the Socket.IO events documented
  // in services/messaging-service/postman.json instead.
];

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isFresh = args.includes("--fresh");
const noSeed = args.includes("--no-seed");
const onlyFlowIdx = args.indexOf("--flow");
const onlyFlowId = onlyFlowIdx !== -1 ? args[onlyFlowIdx + 1]?.toUpperCase() : null;
const selectedFlows = onlyFlowId
  ? FLOWS.filter((f) => f.id === onlyFlowId)
  : FLOWS;

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(msg);
}

function logSection(title) {
  console.log("\n" + "═".repeat(65));
  console.log(`  ${title}`);
  console.log("═".repeat(65));
}

function logStep(step, msg) {
  console.log(`\n[${step}] ${msg}`);
}

// Resolve Newman binary: prefer local node_modules/.bin, then global, then npx
function resolveNewman() {
  const localBin = path.resolve(__dirname, "../node_modules/.bin/newman");
  if (existsSync(localBin)) return localBin;

  try {
    execSync("newman --version", { stdio: "pipe" });
    return "newman";
  } catch {
    return null;
  }
}

let NEWMAN_BIN = null;

function ensureNewman() {
  NEWMAN_BIN = resolveNewman();
  if (!NEWMAN_BIN) {
    log("\n⚠️  Newman not found. Installing as a dev dependency...");
    try {
      execSync("pnpm add -D newman -w", {
        stdio: "inherit",
        cwd: path.resolve(__dirname, ".."),
      });
      NEWMAN_BIN = path.resolve(__dirname, "../node_modules/.bin/newman");
      log("✓ Newman installed.");
    } catch {
      // Fallback: try npm global install
      try {
        execSync("npm install -g newman", { stdio: "inherit" });
        NEWMAN_BIN = "newman";
        log("✓ Newman installed globally.");
      } catch (err) {
        console.error("❌ Failed to install Newman:", err.message);
        console.error("   Please run: pnpm add -D newman -w  OR  npm install -g newman");
        console.error("   Then re-run: pnpm init:flows");
        process.exit(1);
      }
    }
  } else {
    log(`  ✓ Newman found: ${NEWMAN_BIN === "newman" ? "(global)" : "(local node_modules)"}`);
  }
}

async function healthCheck() {
  const url = `${BASE_URL}/api/v1/catalog/app-config`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const json = await res.json();
      return json.success === true || res.status === 200;
    }
    return false;
  } catch {
    return false;
  }
}

function runScript(scriptPath, extraArgs = []) {
  const result = spawnSync(
    "node",
    [scriptPath, ...extraArgs],
    { stdio: "inherit", cwd: path.resolve(__dirname, "..") }
  );
  return result.status === 0;
}

/**
 * Run a single Newman collection file.
 * Returns { passed, failed, assertions, duration, error }
 */
function runNewman(flow) {
  const reportDir = path.resolve(__dirname, "../logs/newman");
  const reportFile = path.join(reportDir, `${flow.id}-${flow.label.replace(/[^a-z0-9]/gi, "_")}.json`);

  // Ensure logs dir exists
  try {
    execSync(`mkdir -p "${reportDir}"`);
  } catch {}

  const newmanArgs = [
    "run",
    flow.file,
    "--env-var", `base_url=${BASE_URL}`,
    "--reporters", "cli,json",
    "--reporter-json-export", reportFile,
    "--color", "on",
    "--timeout-request", "15000",
    "--timeout-script", "10000",
  ];

  const start = Date.now();
  const result = spawnSync(NEWMAN_BIN, newmanArgs, {
    stdio: "inherit",
    cwd: path.resolve(__dirname, ".."),
  });
  const duration = Date.now() - start;

  let assertions = 0;
  let failed = 0;

  // Parse JSON report if it was written
  try {
    const report = JSON.parse(readFileSync(reportFile, "utf-8"));
    assertions = report.run?.stats?.assertions?.total ?? 0;
    failed = report.run?.stats?.assertions?.failed ?? 0;
  } catch {
    // If report parse fails, infer from exit code
    failed = result.status !== 0 ? 1 : 0;
  }

  return {
    passed: result.status === 0,
    failed,
    assertions,
    duration,
    error: result.error?.message ?? null,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  logSection("XpertLink API-Driven Init Script  (pnpm init:flows)");

  log(`  Mode  : ${isFresh ? "FRESH (wipe + seed + flows)" : "INCREMENTAL (seed prereqs + flows)"}`);
  log(`  Flows : ${selectedFlows.map((f) => `${f.id}. ${f.label}`).join(", ")}`);
  log(`  Target: ${BASE_URL}`);
  if (onlyFlowId && selectedFlows.length === 0) {
    console.error(`\n❌  Unknown flow ID: ${onlyFlowId}. Valid IDs are: A, B, C, D, E, F`);
    process.exit(1);
  }

  // ── Step 1: Ensure Newman is available ──────────────────────────────────────
  logStep("1/4", "Checking Newman CLI...");
  ensureNewman();
  log("  ✓ Newman is available");

  // ── Step 2: Optional DB reset ────────────────────────────────────────────────
  if (isFresh) {
    logStep("2/4", "Resetting database (--fresh)...");
    const ok = runScript(path.resolve(__dirname, "reset.js"), ["--no-seed"]);
    if (!ok) {
      console.error("❌ Database reset failed. Aborting.");
      process.exit(1);
    }
    log("  ✓ Database wiped");
  } else {
    logStep("2/4", "Skipping DB wipe (use --fresh to wipe first)");
  }

  // ── Step 3: Seed platform prerequisites ─────────────────────────────────────
  if (!noSeed) {
    logStep("3/4", "Seeding platform prerequisites...");
    const seedOk = runScript(path.resolve(__dirname, "seed-platform.js"));
    if (!seedOk) {
      console.error("❌ Platform seed failed. Aborting.");
      process.exit(1);
    }
  } else {
    logStep("3/4", "Skipping platform seed (--no-seed)");
  }

  // ── Step 4: API gateway health check ────────────────────────────────────────
  logStep("4/4", "Checking API gateway health...");
  let healthy = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    healthy = await healthCheck();
    if (healthy) break;
    if (attempt < 6) {
      log(`  ⏳ Attempt ${attempt}/6 — gateway not ready yet. Retrying in 5s...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  if (!healthy) {
    console.error(`\n❌ API gateway at ${BASE_URL} is not responding.`);
    console.error("   Make sure services are running: pnpm pm2:start\n");
    process.exit(1);
  }
  log("  ✓ API gateway is healthy");

  // ── Run flows ────────────────────────────────────────────────────────────────
  logSection("Running Verified Postman Flow Collections");

  const results = [];

  for (const flow of selectedFlows) {
    log(`\n${"─".repeat(65)}`);
    log(`▶  Flow ${flow.id}: ${flow.label}`);
    log(`   Collection: ${flow.collection}`);
    log(`   File: ${path.relative(process.cwd(), flow.file)}`);
    log("─".repeat(65));

    if (!existsSync(flow.file)) {
      log(`❌ Flow file not found: ${flow.file}`);
      results.push({ ...flow, passed: false, assertions: 0, failed: 0, duration: 0, error: "Collection file not found" });
      continue;
    }

    const result = runNewman(flow);
    results.push({ ...flow, ...result });
  }

  // 7. Backfill missing avatars for all seeded & test-generated users
  logSection("Backfilling Avatars");
  logStep("7", "Uploading missing avatars to S3 and attaching to profiles...");
  try {
    execSync("node scripts/fill-missing-avatars.js", { stdio: "inherit", cwd: path.resolve(__dirname, "..") });
  } catch (err) {
    log("⚠️  Failed to backfill avatars. Proceeding anyway.");
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  logSection("Init Flows Summary");

  const passCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  const totalAssertions = results.reduce((sum, r) => sum + (r.assertions || 0), 0);
  const totalFailed = results.reduce((sum, r) => sum + (r.failed || 0), 0);
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);

  log("");
  log("  Flow  │ Status  │ Assertions │ Failed │ Duration");
  log("  ──────┼─────────┼────────────┼────────┼──────────");
  for (const r of results) {
    const status = r.passed ? "✅ PASS " : "❌ FAIL ";
    const dur = r.duration ? `${(r.duration / 1000).toFixed(1)}s` : "–";
    const assertions = r.assertions ?? "–";
    const failed = r.failed ?? "–";
    log(`  ${r.id.padEnd(5)} │ ${status} │ ${String(assertions).padStart(10)} │ ${String(failed).padStart(6)} │ ${dur}`);
  }
  log("  ──────┼─────────┼────────────┼────────┼──────────");
  log(`  Total │ ${passCount}/${totalCount} pass │ ${String(totalAssertions).padStart(10)} │ ${String(totalFailed).padStart(6)} │ ${(totalDuration / 1000).toFixed(1)}s`);

  log("");

  if (passCount === totalCount) {
    log(`🎉 All ${totalCount} flows passed! Database now contains real API-created data.`);
    log("   You can log in with any of the dynamically generated test accounts.");
    log("   Check logs/newman/ for detailed JSON reports.\n");
  } else {
    log(`⚠️  ${totalCount - passCount}/${totalCount} flow(s) FAILED.`);
    log("   Check the output above for which steps failed and why.");
    log("   Fix the issues, then re-run: pnpm init:flows\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n[init:flows] Fatal error:", err.message || err);
  process.exit(1);
});
