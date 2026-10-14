import { adminUsers } from "@xprtlink/shared/db/repositories/admin/index.js";
import { verifyPassword, hashRefreshToken } from "@xprtlink/shared/auth/password.js";
import { signAccessToken, verifyAccessToken } from "@xprtlink/shared/auth/jwt.js";
import { getRefreshTokenExpiresAt } from "@xprtlink/shared/auth/tokens.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { unauthorized, badRequest } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { getDb } from "@xprtlink/shared/db/index.js";
import { createHash } from "crypto";
import crypto from "crypto";

const isProduction = process.env.NODE_ENV === "production";

function setAuthCookies(res, accessToken, refreshToken) {
  if (accessToken) {
    res.cookie("admin_access_token", accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60 * 1000, // 15 mins
    });
  }
  if (refreshToken) {
    res.cookie("admin_refresh_token", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }
}

function clearAuthCookies(res) {
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
  };
  res.clearCookie("admin_access_token", options);
  res.clearCookie("admin_refresh_token", options);
}

/** Hash an admin JWT for denylist storage (SHA-256 hex, 64 chars) */
function hashAdminToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/** POST /api/auth/login */
export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(badRequest("emailAndPasswordRequired"));
    }

    const admin = await adminUsers().findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { permissions: true },
    });

    if (!admin) return next(unauthorized("invalidEmailOrPassword"));
    if (admin.status !== "active") return next(unauthorized("accountSuspended"));

    const valid = await verifyPassword(password, admin.passwordHash);
    if (!valid) return next(unauthorized("invalidEmailOrPassword"));

    const accessToken = signAccessToken({
      sub: admin.id,
      role: admin.role, // "super_admin" | "subadmin"
    });

    const refreshPlain = crypto.randomBytes(48).toString("hex");
    const refreshHash = hashRefreshToken(refreshPlain);
    const refreshExpiresAt = getRefreshTokenExpiresAt();

    // M8: Record session so logout can actually revoke it
    const decoded = verifyAccessToken(accessToken);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    await getDb().adminSession.createMany({
      data: [
        {
          adminUserId: admin.id,
          tokenHash: hashAdminToken(accessToken),
          expiresAt,
        },
        {
          adminUserId: admin.id,
          tokenHash: refreshHash,
          expiresAt: refreshExpiresAt,
        }
      ]
    });

    setAuthCookies(res, accessToken, refreshPlain);

    const { passwordHash: _ph, ...adminSafe } = admin;

    return ResponseFormatter.success(res, {
      message: getMessage("loginSuccessful"),
      data: {
        accessToken,
        refreshToken: refreshPlain,
        adminUser: {
          ...adminSafe,
          permissions: admin.permissions.reduce((acc, p) => {
            acc[p.module] = p.level;
            return acc;
          }, {}),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/logout — revoke the current admin session */
export async function logout(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = req.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : req.cookies?.admin_access_token);
    const refreshToken = req.body?.refreshToken || req.cookies?.admin_refresh_token;
    const hashes = [];

    if (token) {
      hashes.push(hashAdminToken(token));
    }
    if (refreshToken) {
      hashes.push(hashRefreshToken(refreshToken));
    }

    if (hashes.length > 0) {
      // Revoke these specific sessions (no-op if not found — already revoked or expired)
      await getDb().adminSession.updateMany({
        where: { tokenHash: { in: hashes }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    clearAuthCookies(res);
    return ResponseFormatter.success(res, { message: getMessage("loggedOut") });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/refresh — refresh admin token */
export async function refresh(req, res, next) {
  try {
    const refreshToken = req.cookies?.admin_refresh_token || req.body?.refreshToken;
    if (!refreshToken) return next(badRequest("refreshTokenRequired"));

    const tokenHash = hashRefreshToken(refreshToken);
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
    const session = await getDb().adminSession.findFirst({
      where: { 
        tokenHash, 
        OR: [
          { revokedAt: null },
          { revokedAt: { gt: thirtySecondsAgo } }
        ],
        expiresAt: { gt: new Date() } 
      },
      include: { admin: { include: { permissions: true } } },
    });

    if (!session || !session.admin || session.admin.status !== "active") {
      clearAuthCookies(res);
      return next(unauthorized("invalidRefreshToken"));
    }

    // Revoke the old refresh token (rotation)
    await getDb().adminSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const admin = session.admin;
    const accessToken = signAccessToken({
      sub: admin.id,
      role: admin.role,
    });
    
    const decoded = verifyAccessToken(accessToken);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 10 * 60 * 1000);

    const newRefreshPlain = crypto.randomBytes(48).toString("hex");
    const newRefreshHash = hashRefreshToken(newRefreshPlain);
    const refreshExpiresAt = getRefreshTokenExpiresAt();

    await getDb().adminSession.createMany({
      data: [
        {
          adminUserId: admin.id,
          tokenHash: hashAdminToken(accessToken),
          expiresAt,
        },
        {
          adminUserId: admin.id,
          tokenHash: newRefreshHash,
          expiresAt: refreshExpiresAt,
        }
      ]
    });

    setAuthCookies(res, accessToken, newRefreshPlain);

    const { passwordHash: _ph, ...adminSafe } = admin;

    return ResponseFormatter.success(res, {
      message: getMessage("tokenRefreshed"),
      data: {
        accessToken,
        refreshToken: newRefreshPlain,
        adminUser: {
          ...adminSafe,
          permissions: admin.permissions.reduce((acc, p) => {
            acc[p.module] = p.level;
            return acc;
          }, {}),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/auth/me — return current admin from DB */
export async function me(req, res, next) {
  try {
    const admin = req.adminUser; // set by requireAdmin middleware
    const { passwordHash: _ph, ...adminSafe } = admin;
    return ResponseFormatter.success(res, {
      data: {
        ...adminSafe,
        ...(req.token ? { accessToken: req.token } : {}),
        permissions: admin.permissions.reduce((acc, p) => {
          acc[p.module] = p.level;
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    next(err);
  }
}
