import crypto from "node:crypto";
import { getSecretSync } from "../config/secrets.js";
import { logger } from "./logger.js";
const log = logger.child({ module: "zegoAsrWebhook" });

const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Verify a Cloud Real-time ASR callback.
 *
 * Unlike ZEGO's room callbacks (lowercase fields, Unix seconds) the ASR envelope uses
 * `Signature` / `Timestamp` / `Nonce` with Timestamp in MILLISECONDS. The signature is
 * SHA-1 of the alphabetically sorted [callbackSecret, timestamp, nonce] concatenation.
 */
export function verifyZegoAsrSignature({ Signature, Timestamp, Nonce }) {
  const secret = getSecretSync("ZEGO_ASR_CALLBACK_SECRET") || getSecretSync("ZEGO_CALLBACK_SECRET");
  if (!secret) {
    log.error("[zego-asr] neither ZEGO_ASR_CALLBACK_SECRET nor ZEGO_CALLBACK_SECRET is set");
    return false;
  }
  if (!Signature || Timestamp == null || !Nonce) return false;

  let tsMs = Number(Timestamp);
  if (!Number.isFinite(tsMs)) return false;
  if (tsMs < 1e11) tsMs *= 1000; // tolerate a seconds timestamp
  if (Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
    log.warn("[zego-asr] rejecting callback outside the allowed clock skew");
    return false;
  }

  const expected = crypto
    .createHash("sha1")
    .update([secret, String(Timestamp), String(Nonce)].sort().join(""))
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(String(Signature), "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}
