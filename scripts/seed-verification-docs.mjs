#!/usr/bin/env node
/**
 * seed-verification-docs.mjs
 *
 * API-driven script: creates a real expert account, uploads dummy verification
 * documents through the media API, submits the verification request, and
 * (optionally) auto-approves it via the admin API.
 *
 * What this script does:
 *  1. Registers a fresh expert account via POST /api/v1/auth/register
 *  2. Verifies email via POST /api/v1/auth/otp/verify (uses bypass code 123456)
 *  3. Completes the expert onboarding profile via POST /api/v1/experts/me/onboarding
 *  4. Creates 2 media assets (presigned upload → bypass confirm) for dummy docs
 *  5. Submits the verification request with both doc media IDs
 *  6. (Optional) Logs in as admin and approves the verification via PATCH .../approve
 *
 * Usage:
 *   node scripts/seed-verification-docs.mjs
 *   node scripts/seed-verification-docs.mjs --no-approve   # skip admin approval
 *   node scripts/seed-verification-docs.mjs --url http://localhost:4000
 *   node scripts/seed-verification-docs.mjs --tag prod-demo --no-approve
 *
 * Requirements:
 *   - Backend services must be running (pnpm dev / pm2 start)
 *   - For email OTP bypass, NODE_ENV must be 'development' or 'test'
 *     OR your backend must accept OTP code "123456" in dev mode
 */

import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

/** Safe flag value helper — returns undefined if the next token is another flag or missing */
function getArg(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const next = args[idx + 1];
  return next && !next.startsWith("--") ? next : undefined;
}

const BASE_URL     = getArg("--url") || `http://localhost:${process.env.API_GATEWAY_PORT || 4000}`;
const TAG          = getArg("--tag") || "demo";
const AUTO_APPROVE = !args.includes("--no-approve");
const OTP_BYPASS   = process.env.OTP_BYPASS_CODE || "123456";

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || "admin@xpertlink.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";

// Realistic mock expert personas — one is picked per run
const EXPERT_PERSONAS = [
  { firstName: "Sarah",   lastName: "Mitchell",  title: "Senior Business Consultant",    bio: "Seasoned business consultant with 10+ years helping startups and enterprises scale. Expert in operations, strategy, and team building.", yearsExperience: 10, hourlyRate: 120 },
  { firstName: "James",   lastName: "Okafor",    title: "Legal & Compliance Advisor",    bio: "Corporate attorney specializing in contract law, compliance, and business regulatory matters. Based in New York, available globally.", yearsExperience: 8,  hourlyRate: 200 },
  { firstName: "Priya",   lastName: "Sharma",    title: "Financial Planning Specialist", bio: "Chartered accountant and financial planner helping individuals and businesses with investment strategy, tax optimization, and budgeting.", yearsExperience: 7,  hourlyRate: 95  },
  { firstName: "Carlos",  lastName: "Rivera",    title: "Digital Marketing Strategist",  bio: "Growth marketing expert with deep experience in SEO, paid media, and brand building. Helped 50+ brands grow their digital presence.", yearsExperience: 6,  hourlyRate: 85  },
  { firstName: "Aisha",   lastName: "Abdullah",  title: "Health & Wellness Coach",       bio: "Certified health coach and nutritionist focused on sustainable lifestyle changes, mental wellness, and holistic health management.", yearsExperience: 5,  hourlyRate: 75  },
  { firstName: "Michael", lastName: "Thompson",  title: "Software Architecture Advisor", bio: "Principal engineer and architect with expertise in distributed systems, API design, and cloud infrastructure at scale.", yearsExperience: 12, hourlyRate: 180 },
  { firstName: "Fatima",  lastName: "Al-Hassan", title: "Education & Career Coach",      bio: "Former university professor turned career strategist. Helping students and professionals navigate academic and career transitions.", yearsExperience: 9,  hourlyRate: 80  },
];

// Dummy Unsplash images to use as "document" content (publicly accessible)
const DUMMY_DOC_IMAGES = [
  {
    url: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=800&q=80",
    label: "Government ID (front)",
    docType: "government_id",
    mimeType: "image/jpeg",
  },
  {
    url: "https://images.unsplash.com/photo-1568205631878-0a7fbcee7b7a?auto=format&fit=crop&w=800&q=80",
    label: "Professional Credential",
    docType: "credential",
    mimeType: "image/jpeg",
  },
];


// ── Helpers ───────────────────────────────────────────────────────────────────

const log  = (msg) => console.log(`\n  ${msg}`);
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
const ok   = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exit(1); };

async function api(method, path, body, token) {
  const url = `${BASE_URL}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  let json;
  try { json = await res.json(); } catch { json = {}; }

  return { status: res.status, ok: res.ok, json };
}

function randomEmail(persona, tag) {
  const first  = persona.firstName.toLowerCase().replace(/[^a-z]/g, "");
  const last   = persona.lastName.toLowerCase().replace(/[^a-z]/g, "");
  const suffix = tag !== "demo" ? `.${tag}` : "";
  // Short numeric suffix to keep it unique across runs without exposing timestamps
  const seq    = String(Date.now()).slice(-6);
  return `${first}.${last}${suffix}.${seq}@xprtlink-test.com`;
}

function randomPhone() {
  // E.164 format, US-style test numbers
  const num = Math.floor(Math.random() * 9_000_000) + 1_000_000;
  return `+1555${num}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "═".repeat(65));
  console.log("  XprtLink — API-driven Verification Document Seeder");
  console.log("═".repeat(65));
  log(`Target  : ${BASE_URL}`);
  log(`Tag     : ${TAG}`);
  log(`Approve : ${AUTO_APPROVE ? "yes (admin will approve)" : "no (leaves verification pending)"}`);

  const persona     = EXPERT_PERSONAS[Math.floor(Math.random() * EXPERT_PERSONAS.length)];
  const expertEmail  = randomEmail(persona, TAG);
  const expertPhone  = randomPhone();
  const expertPassword = "Expert@Seed123";

  log(`Persona : ${persona.firstName} ${persona.lastName} — ${persona.title}`);
  log(`Email   : ${expertEmail}`);
  log(`Phone   : ${expertPhone}`);

  step("1/7", "Registering new expert account...");

  const reg = await api("POST", "/api/v1/auth/register", {
    firstName: persona.firstName,
    lastName: persona.lastName,
    email: expertEmail,
    phone: expertPhone,
    password: expertPassword,
    confirmPassword: expertPassword,
    termsAccepted: true,
    role: "expert",
    otpChannel: "email",
  });

  if (!reg.ok) {
    fail(`Registration failed (${reg.status}): ${JSON.stringify(reg.json)}`);
  }
  ok("Account created — OTP sent to email");

  // ── Step 2: Verify OTP ──────────────────────────────────────────────────────
  step("2/7", `Verifying email OTP (bypass code: ${OTP_BYPASS})...`);

  const otp = await api("POST", "/api/v1/auth/otp/verify", {
    email: expertEmail,
    code: OTP_BYPASS,
    purpose: "register",
  });

  if (!otp.ok || !otp.json?.data?.accessToken) {
    fail(
      `OTP verification failed (${otp.status}): ${JSON.stringify(otp.json)}\n` +
      `  → Make sure NODE_ENV=development or OTP_BYPASS_CODE is set in .env`
    );
  }
  const expertToken = otp.json.data.accessToken;
  ok(`Authenticated. Access token received.`);

  // ── Step 3: Complete onboarding profile ────────────────────────────────────
  step("3/7", "Completing expert onboarding profile...");

  // Fetch a category to use
  const cats = await api("GET", "/api/v1/catalog/categories", null, expertToken);
  const categoryId = cats.json?.data?.items?.[0]?.id || cats.json?.data?.[0]?.id;
  if (!categoryId) {
    fail("Could not fetch a category. Run seed-platform.js first.");
  }

  const onboard = await api("POST", "/api/v1/experts/me/onboarding", {
    categories: [categoryId],
    bio: persona.bio,
    hourlyRate: persona.hourlyRate,
    yearsExperience: persona.yearsExperience,
    languages: ["en"],
    timezone: "Asia/Karachi",
    title: persona.title,
  }, expertToken);

  if (!onboard.ok) {
    fail(`Onboarding save failed (${onboard.status}): ${JSON.stringify(onboard.json)}`);
  }

  // Submit onboarding
  const submit = await api("POST", "/api/v1/experts/me/onboarding/submit", {}, expertToken);
  if (!submit.ok) {
    // Non-fatal — profile may already be in submitted state
    log(`⚠ Onboarding submit returned ${submit.status} — continuing`);
  } else {
    ok("Onboarding profile submitted");
  }

  // ── Step 4: Create media assets (presigned upload → bypass confirm) ─────────
  step("4/7", "Creating media assets for verification documents...");

  const mediaIds = [];

  for (const doc of DUMMY_DOC_IMAGES) {
    log(`Creating media asset: ${doc.label}`);

    // 4a. Request presigned upload URL
    const createMedia = await api("POST", "/api/v1/media/uploads", {
      purpose: "verification_doc",
      mimeType: doc.mimeType,
      sizeBytes: 250_000,
    }, expertToken);

    if (!createMedia.ok) {
      fail(`Media create failed (${createMedia.status}): ${JSON.stringify(createMedia.json)}`);
    }

    const mediaId = createMedia.json?.data?.id || createMedia.json?.data?.mediaId;
    const uploadUrl = createMedia.json?.data?.uploadUrl;

    if (!mediaId) {
      fail(`No media ID returned: ${JSON.stringify(createMedia.json)}`);
    }

    ok(`Media asset created: ${mediaId}`);

    // 4b. If we got a presigned S3 URL, upload a tiny dummy blob to it.
    //     In local dev, the media service may store locally and not need a real upload.
    if (uploadUrl && uploadUrl.startsWith("http")) {
      try {
        // Download the dummy image and upload it to the presigned URL
        const imgRes = await fetch(doc.url, { signal: AbortSignal.timeout(10_000) });
        if (imgRes.ok) {
          const imgBuffer = await imgRes.arrayBuffer();
          const putRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": doc.mimeType },
            body: imgBuffer,
          });
          ok(`Uploaded dummy image to presigned URL (${putRes.status})`);
        }
      } catch (e) {
        log(`⚠ Could not upload to presigned URL: ${e.message} — will confirm anyway`);
      }
    }

    // 4c. Confirm upload so the media asset moves to status=ready
    const confirm = await api("POST", `/api/v1/media/${mediaId}/confirm`, {
      storageKey: `verification_docs/demo/${mediaId}.jpg`,
    }, expertToken);

    if (!confirm.ok) {
      log(`⚠ Media confirm returned ${confirm.status} — asset may still be pending_upload`);
      log(`  This is OK — some backends auto-confirm on local storage`);
    } else {
      ok(`Media asset confirmed as ready: ${mediaId}`);
    }

    mediaIds.push({ mediaId, docType: doc.docType, label: doc.label });
  }

  // ── Step 5: Submit verification documents ──────────────────────────────────
  step("5/7", "Submitting verification request with document IDs...");

  const verifyBody = {
    primaryId: mediaIds[0].mediaId,
  };
  if (mediaIds[1]) {
    verifyBody.secondaryId = mediaIds[1].mediaId;
  }

  log(`Payload: ${JSON.stringify(verifyBody, null, 2)}`);

  const verify = await api(
    "POST",
    "/api/v1/experts/me/verification/documents",
    verifyBody,
    expertToken
  );

  if (!verify.ok) {
    fail(
      `Verification submission failed (${verify.status}):\n  ${JSON.stringify(verify.json, null, 2)}`
    );
  }

  const verificationId =
    verify.json?.data?.verificationId ||
    verify.json?.data?.id ||
    verify.json?.data?.verification?.id;

  ok(`Verification submitted! ID: ${verificationId || "(check admin portal)"}`);

  // ── Step 6: Check verification is visible via admin API ────────────────────
  step("6/7", "Verifying expert verification is visible in admin API...");

  // Admin login
  const adminLogin = await api("POST", "/api/v1/admin/auth/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });

  if (!adminLogin.ok || !adminLogin.json?.data?.accessToken) {
    fail(`Admin login failed (${adminLogin.status}): ${JSON.stringify(adminLogin.json)}`);
  }
  const adminToken = adminLogin.json.data.accessToken;
  ok("Admin authenticated");

  // List pending verifications and find ours
  const pending = await api("GET", "/api/v1/admin/verifications?status=pending", null, adminToken);
  const items = pending.json?.data?.items || [];
  const ourVerif = items.find(
    (v) => v.expert?.user?.email === expertEmail || verificationId === v.id
  );

  if (ourVerif) {
    ok(`Found our verification in admin list: ${ourVerif.id}`);
    ok(`Documents count: ${ourVerif.documentCount}`);
  } else {
    log(`⚠ Verification not found in pending list (may be under a different email/status).`);
    log(`  Pending items: ${items.length}`);
  }

  // ── Step 7: Admin approval (optional) ─────────────────────────────────────
  if (AUTO_APPROVE) {
    step("7/7", "Auto-approving the verification as admin...");

    const targetId = ourVerif?.id || verificationId;
    if (!targetId) {
      log("⚠ Could not determine verification ID — skipping approval");
    } else {
      const approve = await api(
        "PATCH",
        `/api/v1/admin/verifications/${targetId}/approve`,
        { notes: `Auto-approved by seed-verification-docs (tag: ${TAG})` },
        adminToken
      );

      if (!approve.ok) {
        log(`⚠ Approval returned ${approve.status}: ${JSON.stringify(approve.json)}`);
      } else {
        ok(`Verification ${targetId} approved!`);
      }
    }
  } else {
    step("7/7", "Skipping auto-approval (--no-approve flag). Verification is PENDING.");
    log("Open the admin portal → Verifications to review and approve manually.");
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(65));
  console.log("  ✅  Done! Real API-seeded verification data:");
  console.log("═".repeat(65));
  console.log(`  Expert name     : ${persona.firstName} ${persona.lastName}`);
  console.log(`  Expert email    : ${expertEmail}`);
  console.log(`  Expert password : ${expertPassword}`);
  console.log(`  Title           : ${persona.title}`);
  console.log(`  Rate            : $${persona.hourlyRate}/hr  |  ${persona.yearsExperience} yrs experience`);
  console.log(`  Verification ID : ${ourVerif?.id || verificationId || "(check portal)"}`);
  console.log(`  Documents       : ${mediaIds.map((m) => m.label).join(", ")}`);
  console.log(`  Status          : ${AUTO_APPROVE ? "approved" : "pending (awaiting admin review)"}`);
  console.log(`  Admin portal    : ${process.env.ADMIN_BASE_URL || "https://devadmin.xprtlink.com"}/verifications`);
  console.log("═".repeat(65) + "\n");
}

main().catch((err) => {
  console.error("\n[seed-verification-docs] Fatal error:", err.message || err);
  process.exit(1);
});
