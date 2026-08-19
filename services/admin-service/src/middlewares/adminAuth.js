import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { adminUsers } from "@xprtlink/shared/db/repositories/admin/index.js";
import { forbidden, unauthorized } from "@xprtlink/shared/utils/errors.js";

const ADMIN_ROLES = ["super_admin", "subadmin"];

/**
 * Verify JWT and ensure caller is an admin user.
 * Attaches req.adminUser (AdminUser row + permissions).
 */
export async function requireAdmin(req, res, next) {
  // First verify JWT generically
  authenticate(req, res, async (err) => {
    if (err) return next(err);
    if (!req.auth) return next(unauthorized());

    if (!ADMIN_ROLES.includes(req.auth.role)) {
      return next(forbidden("Admin access required"));
    }

    try {
      const admin = await adminUsers().findUnique({
        where: { id: req.auth.userId },
        include: { permissions: true },
      });

      if (!admin || admin.status !== "active") {
        return next(unauthorized("Admin account not found or suspended"));
      }

      req.adminUser = admin;
      next();
    } catch (dbErr) {
      next(dbErr);
    }
  });
}

/**
 * Helper — check if current admin has at least `level` on `module`.
 * Returns true for super_admin unconditionally.
 */
export function hasPermission(adminUser, module, level = "view") {
  if (!adminUser) return false;
  if (adminUser.role === "super_admin") return true;
  const perm = adminUser.permissions?.find((p) => p.module === module);
  if (!perm) return false;
  if (level === "view") return ["view", "edit"].includes(perm.level);
  if (level === "edit") return perm.level === "edit";
  return false;
}

/**
 * Express middleware factory — gate a route by module + level.
 */
export function requirePermission(module, level = "view") {
  return (req, _res, next) => {
    if (!hasPermission(req.adminUser, module, level)) {
      return next(forbidden(`Insufficient permission for module: ${module}`));
    }
    next();
  };
}

/**
 * Express middleware — restrict a route to super_admin only.
 * Must run after requireAdmin (relies on req.adminUser).
 */
export function requireSuperAdmin(req, _res, next) {
  if (req.adminUser?.role !== "super_admin") {
    return next(forbidden("Super admin access required"));
  }
  next();
}
