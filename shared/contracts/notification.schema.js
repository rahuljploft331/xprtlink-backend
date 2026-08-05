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
  platform: z.enum(["ios", "android", "web"]),
});
