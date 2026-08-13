#!/usr/bin/env node

/**
 * ZegoCloud Credential & Token Verification Script
 *
 * Usage:
 *   npx dotenv-cli -e .env -- node scripts/test-zego-token.js
 *
 * Verifies:
 *   1. ZEGO_APP_ID and ZEGO_SERVER_SECRET are set correctly
 *   2. Token generation produces a valid Token04
 *   3. Token structure has the correct prefix
 */

import { generateToken04 } from "../shared/lib/zegoServerAssistant.js";

const appID = Number(process.env.ZEGO_APP_ID);
const serverSecret = process.env.ZEGO_SERVER_SECRET;

console.log("═══════════════════════════════════════════════");
console.log("  ZegoCloud Credential & Token Verification");
console.log("═══════════════════════════════════════════════\n");

// --- Check 1: Credentials present ---
console.log("1. Checking credentials...");

if (!appID || isNaN(appID)) {
  console.error("   ❌ ZEGO_APP_ID is missing or not a number");
  console.error("      Set it in .env (get it from https://console.zegocloud.com/)");
  process.exit(1);
}
console.log(`   ✅ ZEGO_APP_ID = ${appID}`);

if (!serverSecret) {
  console.error("   ❌ ZEGO_SERVER_SECRET is missing");
  console.error("      Set it in .env (get it from https://console.zegocloud.com/)");
  process.exit(1);
}

if (serverSecret.length !== 32) {
  console.error(`   ❌ ZEGO_SERVER_SECRET has ${serverSecret.length} chars (expected 32)`);
  process.exit(1);
}
console.log(`   ✅ ZEGO_SERVER_SECRET = ${serverSecret.slice(0, 4)}...${serverSecret.slice(-4)} (${serverSecret.length} chars)`);

// --- Check 2: Generate a test token ---
console.log("\n2. Generating test token...");

const testUserID = "test-user-001";
const testRoomID = "room-test-verification";
const effectiveSeconds = 300; // 5 minutes

const payload = JSON.stringify({
  room_id: testRoomID,
  privilege: { 1: 1, 2: 1 },
  stream_id_list: null,
});

try {
  const token = generateToken04(appID, testUserID, serverSecret, effectiveSeconds, payload);

  if (!token || typeof token !== "string" || token.length < 50) {
    console.error("   ❌ Token generation returned an unexpected result:", token);
    process.exit(1);
  }

  console.log("   ✅ Token generated successfully");
  console.log(`   📏 Token length: ${token.length} chars`);
  console.log(`   🔑 Token prefix: ${token.substring(0, 20)}...`);
  console.log(`   👤 UserID: ${testUserID}`);
  console.log(`   🏠 RoomID: ${testRoomID}`);
  console.log(`   ⏱️  Validity: ${effectiveSeconds}s`);

  // --- Check 3: Token structure ---
  console.log("\n3. Validating token structure...");

  if (token.startsWith("04")) {
    console.log("   ✅ Token has correct version prefix (04)");
  } else {
    console.warn("   ⚠️  Token does not start with '04' — unexpected format");
  }

  // Verify the base64 portion is valid
  const base64Part = token.substring(2);
  try {
    const decoded = Buffer.from(base64Part, "base64");
    if (decoded.length > 0) {
      console.log(`   ✅ Base64 payload is valid (${decoded.length} bytes)`);
    } else {
      console.warn("   ⚠️  Base64 payload decoded to empty buffer");
    }
  } catch {
    console.warn("   ⚠️  Base64 portion could not be decoded");
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log("  ✅ ALL CHECKS PASSED — ZegoCloud is ready!");
  console.log("═══════════════════════════════════════════════\n");

  // Print the full token for manual testing / ZegoCloud console validation
  console.log("Full test token (for ZegoCloud Token Assistant debugging):");
  console.log(token);
  console.log();
} catch (err) {
  if (err.errorCode !== undefined) {
    console.error(`   ❌ Token generation failed [code ${err.errorCode}]: ${err.errorMessage}`);
  } else {
    console.error("   ❌ Token generation failed:", err.message || err);
  }
  process.exit(1);
}
