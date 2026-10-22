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
  password: z.string().min(8).regex(/^\S+$/, "Password cannot contain spaces"),
  role: z.literal("subadmin").optional().default("subadmin"),
  status: z.enum(["active", "suspended"]).optional().default("active"),
  permissions: z.record(z.enum(ADMIN_MODULES), z.enum(PERMISSION_LEVEL_VALUES)).optional(),
});

export const updateAdminSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  avatarUrl: z.string().nullable().optional(),
  password: z.string().min(8).regex(/^\S+$/, "Password cannot contain spaces").optional(),
});

export const updateAdminProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  avatarUrl: z.string().nullable().optional(),
  avatarBase64: z.string().nullable().optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
});

export const setPermissionsSchema = z.object({
  permissions: z.record(z.enum(ADMIN_MODULES), z.enum(PERMISSION_LEVEL_VALUES)),
});

export const broadcastNotificationRequestSchema = z.object({
  audience: z.enum(["all", "customers", "experts"]),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  type: z.enum(["marketing", "system", "announcement"]).default("system"),
});
