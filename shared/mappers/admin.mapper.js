import { toIso } from "./common.js";

/**
 * Admin user DTO — explicit allow-list, never exposes passwordHash or other
 * raw Prisma fields.
 */
export function toAdminUserDto(admin) {
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    status: admin.status,
    permissionsMap: (admin.permissions ?? []).reduce((acc, p) => {
      acc[p.module] = p.level;
      return acc;
    }, {}),
    createdAt: toIso(admin.createdAt),
    updatedAt: toIso(admin.updatedAt),
  };
}
