import crypto from "crypto";
import { getDb } from "../db/getClient.js";
import { getSecretSync } from "../config/secrets.js";
import { getExpiresInSeconds, signAccessToken } from "../auth/jwt.js";
import { hashToken } from "../auth/password.js";
import { toAuthSessionDto, toAuthTokensDto } from "../mappers/auth.mapper.js";

export function getRefreshTokenExpiresAt() {
  const raw = String(getSecretSync("REFRESH_TOKEN_EXPIRES_IN", "30d")).trim().toLowerCase();
  
  // Infinite / non-expiring presets (100 years in the future)
  if (["never", "infinite", "forever", "none", "0"].includes(raw)) {
    return new Date(Date.now() + 100 * 365.25 * 24 * 60 * 60 * 1000);
  }

  let ms = 30 * 24 * 60 * 60 * 1000;
  if (raw.endsWith("y")) ms = parseInt(raw, 10) * 365.25 * 86400 * 1000; // e.g. "10y", "100y"
  else if (raw.endsWith("d")) ms = parseInt(raw, 10) * 86400 * 1000;      // e.g. "30d", "90d"
  else if (raw.endsWith("h")) ms = parseInt(raw, 10) * 3600 * 1000;       // e.g. "24h"
  else if (raw.endsWith("m")) ms = parseInt(raw, 10) * 60 * 1000;         // e.g. "60m"
  else if (!isNaN(Number(raw))) ms = parseInt(raw, 10) * 1000;

  return new Date(Date.now() + ms);
}

export async function loadUserContext(userId) {
  const db = getDb();
  return db.user.findUnique({
    where: { id: userId },
    include: {
      customerProfile: true,
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
  const refreshHash = await hashToken(refreshPlain);
  const expiresAt = getRefreshTokenExpiresAt();

  await getDb().refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refreshHash,
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

export async function revokeRefreshToken(refreshToken) {
  const db = getDb();
  const tokens = await db.refreshToken.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    take: 200,
    orderBy: { createdAt: "desc" },
  });
  const { verifyTokenHash } = await import("../auth/password.js");
  for (const row of tokens) {
    if (await verifyTokenHash(refreshToken, row.tokenHash)) {
      await db.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
      return row.userId;
    }
  }
  return null;
}
