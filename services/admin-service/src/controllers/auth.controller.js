import { adminUsers } from "@xprtlink/shared/db/repositories/admin/index.js";
import { verifyPassword } from "@xprtlink/shared/auth/password.js";
import { signAccessToken, verifyAccessToken } from "@xprtlink/shared/auth/jwt.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { unauthorized, badRequest } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { getDb } from "@xprtlink/shared/db";
import { createHash } from "crypto";

/** Hash an admin JWT for denylist storage (SHA-256 hex, 64 chars) */
function hashAdminToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/** POST /api/auth/login */
export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(badRequest("Email and password are required"));
    }

    const admin = await adminUsers().findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { permissions: true },
    });

    if (!admin) return next(unauthorized("Invalid email or password"));
    if (admin.status !== "active") return next(unauthorized("Account is suspended"));

    const valid = await verifyPassword(password, admin.passwordHash);
    if (!valid) return next(unauthorized("Invalid email or password"));

    const accessToken = signAccessToken({
      sub: admin.id,
      role: admin.role, // "super_admin" | "subadmin"
    });

    // M8: Record session so logout can actually revoke it
    const decoded = verifyAccessToken(accessToken);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await getDb().adminSession.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashAdminToken(accessToken),
        expiresAt,
      },
    });

    const { passwordHash: _ph, ...adminSafe } = admin;

    return ResponseFormatter.success(res, {
      message: getMessage("loginSuccessful"),
      data: {
        accessToken,
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
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const tokenHash = hashAdminToken(token);
      // Revoke this specific session (no-op if not found — already revoked or expired)
      await getDb().adminSession.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return ResponseFormatter.success(res, { message: getMessage("loggedOut") });
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
