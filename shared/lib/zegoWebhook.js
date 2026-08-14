import crypto from "crypto";
import { getSecretSync } from "../config/secrets.js";

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
 * @param {string} signature - The signature from the webhook payload
 * @param {string} timestamp - The timestamp from the webhook payload
 * @param {string} nonce     - The nonce from the webhook payload
 * @returns {boolean} True if signature is valid
 */
export function verifyZegoSignature(signature, timestamp, nonce) {
  const callbackSecret = getSecretSync("ZEGO_CALLBACK_SECRET");
  if (!callbackSecret) {
    console.error("[zego-webhook] ZEGO_CALLBACK_SECRET is not set");
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
