import crypto from "crypto";
import { getDb } from "../db/getClient.js";
import { getSecretSync } from "../config/secrets.js";
import { getExpiresInSeconds, signAccessToken } from "../auth/jwt.js";
import { hashToken, hashRefreshToken, verifyTokenHash } from "../auth/password.js";
import { toAuthSessionDto, toAuthTokensDto } from "../mappers/auth.mapper.js";

export function getRefreshTokenExpiresAt() {
  const raw = String(getSecretSync("REFRESH_TOKEN_EXPIRES_IN", "30d")).trim().toLowerCase();
  
  // Infinite / non-expiring presets (100 years in the future)
  if (["never", "infinite", "forever", "none", "0"].includes(raw)) {
    return new Date(Date.now() + 100 * 365.25 * 24 * 60 * 60 * 1000);
  }

  let ms = 30 * 24 * 60 * 60 * 1000;
  if (raw.endsWith("y")) ms = parseInt(raw, 10) * 365.25 * 86400 * 1000;
  else if (raw.endsWith("d")) ms = parseInt(raw, 10) * 86400 * 1000;
  else if (raw.endsWith("h")) ms = parseInt(raw, 10) * 3600 * 1000;
  else if (raw.endsWith("m")) ms = parseInt(raw, 10) * 60 * 1000;
  else if (!isNaN(Number(raw))) ms = parseInt(raw, 10) * 1000;

  return new Date(Date.now() + ms);
}

export async function loadUserContext(userId) {
  const db = getDb();
  return db.user.findUnique({
    where: { id: userId },
    include: {
      customerProfile: {
        include: { avatarMedia: true },
      },
      expertProfile: {
        include: {
          subscriptions: {
            where: { status: "active" },
            take: 1,
          },
        },
      },
    },
  });
}

export function resolveRoleContext(user, role) {
  const customerProfile = user.customerProfile;
  const expertProfile = user.expertProfile;
  const subscriptionActive = Boolean(expertProfile?.subscriptions?.length);

  if (role === "customer" && !customerProfile) {
    return null;
  }
  if (role === "expert" && !expertProfile) {
    return null;
  }

  return {
    role,
    customerProfileId: customerProfile?.id ?? null,
    expertProfileId: expertProfile?.id ?? null,
    subscriptionActive,
  };
}

export async function issueTokens(user, role) {
  const ctx = resolveRoleContext(user, role);
  if (!ctx) return null;

  const accessToken = signAccessToken({
    sub: user.id,
    role: ctx.role,
    customerProfileId: ctx.customerProfileId,
    expertProfileId: ctx.expertProfileId,
  });

  const refreshPlain = crypto.randomBytes(48).toString("hex");
  // Use fast SHA-256 HMAC — deterministic so we can do a direct DB lookup on refresh
  const refreshHash = hashRefreshToken(refreshPlain);
  const expiresAt = getRefreshTokenExpiresAt();

  await getDb().refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refreshHash,
      role: ctx.role,
      expiresAt,
    },
  });

  const session = toAuthSessionDto({
    user,
    role: ctx.role,
    customerProfile: user.customerProfile,
    expertProfile: user.expertProfile,
    gates: { expertSubscriptionActive: ctx.subscriptionActive },
  });

  return toAuthTokensDto({
    accessToken,
    refreshToken: refreshPlain,
    expiresIn: getExpiresInSeconds(),
    session,
  });
}

/**
 * Find a refresh token by its SHA-256 hash (O(1) indexed lookup).
 * Falls back to bcrypt loop for legacy tokens issued before this migration.
 */
async function findRefreshTokenRow(db, refreshToken) {
  // SHA-256 HMAC indexed lookup — O(1) direct DB query
  const fastHash = hashRefreshToken(refreshToken);
  const fast = await db.refreshToken.findFirst({
    where: { tokenHash: fastHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: {
      user: {
        include: {
          customerProfile: true,
          expertProfile: { include: { subscriptions: { where: { status: "active" }, take: 1 } } },
        },
      },
    },
  });
  return fast || null;
}

export async function revokeRefreshToken(refreshToken) {
  const db = getDb();

  // SHA-256 HMAC indexed lookup
  const fastHash = hashRefreshToken(refreshToken);
  const fast = await db.refreshToken.findFirst({
    where: { tokenHash: fastHash, revokedAt: null },
  });
  if (fast) {
    await db.refreshToken.update({ where: { id: fast.id }, data: { revokedAt: new Date() } });
    return fast.userId;
  }

  return null;
}

/**
 * Revoke ALL active refresh tokens for a given userId.
 * Called by password reset and password change to invalidate attacker sessions.
 */
export async function revokeAllUserSessions(userId) {
  const db = getDb();
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Called by user-service refresh endpoint.
 * Returns { user, resolvedRole } or null if token is invalid.
 */
export async function lookupRefreshToken(refreshToken, preferredRole) {
  const db = getDb();
  const row = await findRefreshTokenRow(db, refreshToken);
  if (!row) return null;

  const user = row.user;

  // C2: Enforce bans/suspensions/deletions at token refresh time.
  // A banned user must not be able to obtain new tokens — ever.
  if (user.status !== "active") {
    // Revoke this token so it can never be used again
    await db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return null;
  }

  const resolvedRole =
    preferredRole ||
    row.role ||
    (user.customerProfile ? "customer" : user.expertProfile ? "expert" : null);

  if (!resolvedRole) return null;

  // Rotate: revoke old token, new one issued by issueTokens()
  await db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });

  return { user, resolvedRole };
}
