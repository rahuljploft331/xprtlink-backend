import bcrypt from "bcryptjs";
import crypto from "crypto";

const ROUNDS = 10;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

// ─── Legacy bcrypt token hashing (OTP challenges) ────────────────────────────
// OTP codes are short-lived and typed by users, so bcrypt is appropriate.

export async function hashToken(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyTokenHash(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ─── Fast SHA-256 token hashing (refresh tokens) ─────────────────────────────
// Refresh tokens are long (96-char hex), randomly generated, and never typed
// by users, so bcrypt's slow hashing is unnecessary and hurts performance.
// SHA-256 HMAC with a server secret is the standard approach (used by e.g. NextAuth).
//
// The resulting hash is stored in DB, enabling a single indexed WHERE lookup
// instead of loading all active tokens and doing bcrypt in a loop.

export function hashRefreshToken(plain) {
  const secret = process.env.JWT_SECRET || process.env.REFRESH_TOKEN_SECRET || "xprtlink-refresh-secret";
  return crypto.createHmac("sha256", secret).update(plain).digest("hex");
}
