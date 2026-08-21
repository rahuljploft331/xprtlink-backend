import { z } from "zod";

export const consultationStatusSchema = z.enum([
  "requested",
  "ringing",
  "accepted",
  "in_progress",
  "completed",
  "declined",
  "canceled",
  "failed",
]);

export const consultationBillingStatusSchema = z.enum([
  "pending",
  "charged",
  "failed",
  "refunded",
]);

export const consultationSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  status: consultationStatusSchema,
  expertId: z.string().uuid(),
  expertName: z.string(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  ratePerMinute: z.number(),
  currency: z.string().length(3),
  durationSeconds: z.number().int().nonnegative().nullable(),
  billingStatus: consultationBillingStatusSchema,
  requestedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});

export const consultationDetailDtoSchema = consultationSummaryDtoSchema.extend({
  acceptedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  zegoRoomId: z.string().nullable(),
  hasReview: z.boolean(),
});

export const consultationBillingSummaryDtoSchema = z.object({
  consultationId: z.string().uuid(),
  durationSeconds: z.number().int().nonnegative(),
  ratePerMinute: z.number(),
  currency: z.string().length(3),
  subtotal: z.number(),
  commission: z.number(),
  total: z.number(),
});

export const videoTokenDtoSchema = z.object({
  token: z.string(),
  roomId: z.string(),
  expiresAt: z.string().datetime(),
});

export const createConsultationRequestSchema = z.object({
  expertId: z.string().uuid(),
});

export const submitReviewRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export const reviewDtoSchema = z.object({
  id: z.string().uuid(),
  consultationId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  status: z.enum(["published", "hidden", "flagged"]),
  createdAt: z.string().datetime(),
});

export const expertReportRequestSchema = z.object({
  expertId: z.string().uuid(),
  reason: z.string().min(1).max(120),
  details: z.string().max(2000).optional(),
});

export const expertReportDtoSchema = z.object({
  id: z.string().uuid(),
  expertId: z.string().uuid(),
  reason: z.string(),
  details: z.string().nullable(),
  status: z.enum(["open", "reviewing", "resolved", "dismissed"]),
  createdAt: z.string().datetime(),
});
