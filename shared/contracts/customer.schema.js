import { z } from "zod";

export const customerMeDtoSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  avatarUrl: z.string().url().nullable(),
  status: z.enum(["active", "suspended", "deleted"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const customerMeUpdateRequestSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  avatarMediaId: z.string().uuid().nullable().optional(),
});

export const savedExpertSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  headline: z.string().nullable(),
  categorySlug: z.string(),
  categoryName: z.string(),
  consultationRate: z.number(),
  currency: z.string().length(3),
  availabilityStatus: z.enum(["online", "offline", "busy"]),
  rating: z.number().nullable(),
  reviewCount: z.number().int().nonnegative(),
  savedAt: z.string().datetime(),
});

export const recentlyViewedExpertDtoSchema = savedExpertSummaryDtoSchema.extend({
  viewedAt: z.string().datetime(),
});
