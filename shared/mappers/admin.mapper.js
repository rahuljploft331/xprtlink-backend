import { toIso } from "./common.js";
import { decryptPassword } from "../utils/passwordVault.js";

/**
 * Admin user DTO — explicit allow-list, never exposes passwordHash or other
 * raw Prisma fields.
 */
export function toAdminUserDto(admin) {
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    avatarUrl: admin.avatarUrl ?? null,
    role: admin.role,
    status: admin.status,
    currentPassword: admin.role === "subadmin" ? decryptPassword(admin.passwordEncrypted) : null,
    rawPassword: admin.role === "subadmin" ? decryptPassword(admin.passwordEncrypted) : null,
    permissionsMap: (admin.permissions ?? []).reduce((acc, p) => {
      acc[p.module] = p.level;
      return acc;
    }, {}),
    createdAt: toIso(admin.createdAt),
    updatedAt: toIso(admin.updatedAt),
  };
}
