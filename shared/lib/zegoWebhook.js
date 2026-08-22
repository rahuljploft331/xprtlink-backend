import crypto from "crypto";
import { getSecretSync } from "../config/secrets.js";

/** Maximum allowed age of a webhook callback (5 minutes) */
const MAX_CALLBACK_AGE_MS = 5 * 60 * 1000;

/**
 * Verify ZegoCloud webhook callback signature.
 *
 * ZegoCloud signature algorithm:
 *   1. Create array of [callbackSecret, timestamp, nonce]
 *   2. Sort alphabetically
 *   3. Concatenate into one string
 *   4. SHA-1 hash → hex digest
 *   5. Compare with incoming signature
 *
 * Additionally enforces timestamp freshness to prevent replay attacks.
 *
 * @param {string} signature - The signature from the webhook payload
 * @param {string} timestamp - The timestamp from the webhook payload (Unix seconds)
 * @param {string} nonce     - The nonce from the webhook payload
 * @returns {boolean} True if signature is valid and timestamp is fresh
 */
export function verifyZegoSignature(signature, timestamp, nonce) {
  const callbackSecret = getSecretSync("ZEGO_CALLBACK_SECRET");
  if (!callbackSecret) {
    console.error("[zego-webhook] ZEGO_CALLBACK_SECRET is not set");
    return false;
  }

  // Replay protection: reject callbacks older than MAX_CALLBACK_AGE_MS
  const callbackTime = Number(timestamp) * 1000; // Convert Unix seconds to ms
  const age = Date.now() - callbackTime;
  if (isNaN(callbackTime) || age > MAX_CALLBACK_AGE_MS || age < -MAX_CALLBACK_AGE_MS) {
    console.warn(`[zego-webhook] Rejecting stale/future callback (age=${Math.round(age / 1000)}s)`);
    return false;
  }

  const arr = [callbackSecret, String(timestamp), String(nonce)];
  arr.sort();
  const joined = arr.join("");

  const expected = crypto
    .createHash("sha1")
    .update(joined)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expected, "utf8")
    );
  } catch {
    return false;
  }
}
