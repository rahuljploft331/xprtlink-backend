import { adminUsers } from "@xprtlink/shared/db/repositories/admin/index.js";
import { verifyPassword } from "@xprtlink/shared/auth/password.js";
import { signAccessToken } from "@xprtlink/shared/auth/jwt.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { unauthorized, badRequest } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


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

/** POST /api/auth/logout — stateless JWT; just acknowledge */
export async function logout(_req, res) {
  return ResponseFormatter.success(res, { message: getMessage("loggedOut") });
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
