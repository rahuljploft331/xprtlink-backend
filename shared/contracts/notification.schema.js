import { z } from "zod";

export const notificationDtoSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  payload: z.record(z.unknown()),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const unreadCountDtoSchema = z.object({
  count: z.number().int().nonnegative(),
});

export const notificationPreferencesDtoSchema = z.object({
  preferences: z.record(z.boolean()),
});

export const deviceTokenRequestSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]).optional().default("android"),
});

/**
 * Internal dispatch payload (POST /api/v1/notifications/dispatch).
 *
 * `audience` decides which app surface the row belongs to. It is optional only
 * so an older caller cannot 500 the endpoint — omitting it lands the row in the
 * shared `all` bucket, visible to BOTH roles, and the service logs a warning.
 * New call sites must always set it.
 */
export const dispatchNotificationRequestSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(500),
  type: z.string().min(1).max(64).optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  audience: z.enum(["customer", "expert", "all"]).optional(),
  data: z.record(z.unknown()).optional().default({}),
});

export const updateNotificationPreferencesRequestSchema = z.object({
  preferences: z.record(z.boolean()),
});
