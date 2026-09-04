import { z } from "zod";
import { ADMIN_MODULES, ADMIN_PERMISSION_LEVELS } from "../constants/index.js";

const PERMISSION_LEVEL_VALUES = Object.values(ADMIN_PERMISSION_LEVELS);

/**
 * Creating an admin through this endpoint can only ever produce a subadmin —
 * super_admin accounts are provisioned out-of-band, never via this API.
 */
export const createAdminSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.literal("subadmin").optional().default("subadmin"),
});

export const updateAdminSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const setPermissionsSchema = z.object({
  permissions: z.record(z.enum(ADMIN_MODULES), z.enum(PERMISSION_LEVEL_VALUES)),
});

export const broadcastNotificationRequestSchema = z.object({
  audience: z.enum(["all", "customers", "experts"]),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  type: z.enum(["marketing", "system", "transactional"]).default("system"),
});
