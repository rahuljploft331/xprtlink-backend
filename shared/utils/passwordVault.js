import crypto from "node:crypto";

/**
 * Reversible (AES-256-GCM) storage for subadmin passwords so a super admin can
 * view them. The key lives in env (ADMIN_PASSWORD_ENC_KEY), never in the DB, so a
 * DB dump alone does not reveal passwords. Login still uses the bcrypt hash.
 * Format: v1:<iv>:<tag>:<ciphertext> (base64url).
 */
function getKey() {
  const secret = process.env.ADMIN_PASSWORD_ENC_KEY;
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptPassword(plain) {
  const key = getKey();
  if (!key || !plain) {
    if (!key) console.warn("[passwordVault] ADMIN_PASSWORD_ENC_KEY not set; password not stored for viewing");
    return null;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), enc].map((p) => (Buffer.isBuffer(p) ? p.toString("base64url") : p)).join(":");
}

export function decryptPassword(stored) {
  const key = getKey();
  if (!key || !stored) return null;
  try {
    const [, iv, tag, enc] = stored.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
