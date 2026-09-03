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
  displayId: z.string(),
  title: z.string().nullable(),
  note: z.string().nullable(),
  status: consultationStatusSchema,
  expertId: z.string().uuid(),
  expertName: z.string(),
  expertAvatar: z.string().nullable(),
  expertTitle: z.string().nullable(),
  expertVerificationStatus: z.string().nullable(),
  expertRating: z.number().nullable(),
  expertRatingAvg: z.number().nullable(),
  expertReviewCount: z.number().int().nonnegative(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  customerAvatar: z.string().nullable(),
  ratePer30Minutes: z.number(),
  ratePerMinute: z.number(),
  currency: z.string().length(3),
  durationSeconds: z.number().int().nonnegative().nullable(),
  billableMinutes: z.number().int().nonnegative(),
  total: z.number(),
  billingStatus: consultationBillingStatusSchema,
  requestedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  hasReview: z.boolean(),
});

export const consultationBillingSummaryDtoSchema = z.object({
  consultationId: z.string().uuid(),
  durationSeconds: z.number().int().nonnegative(),
  billableMinutes: z.number().int().nonnegative(),
  ratePer30Minutes: z.number(),
  ratePerMinute: z.number(),
  currency: z.string().length(3),
  subtotal: z.number(),
  commission: z.number(),
  expertShare: z.number(),
  total: z.number(),
  billingStatus: consultationBillingStatusSchema.nullable(),
  paymentBrand: z.string().nullable(),
  paymentLast4: z.string().nullable(),
});

export const reviewDtoSchema = z.object({
  id: z.string().uuid(),
  consultationId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  status: z.enum(["published", "hidden", "flagged"]),
  createdAt: z.string().datetime(),
});

export const consultationDetailDtoSchema = consultationSummaryDtoSchema.extend({
  acceptedAt: z.string().datetime().nullable(),
  zegoRoomId: z.string().nullable(),
  review: reviewDtoSchema.nullable(),
  billing: consultationBillingSummaryDtoSchema.nullable().optional(),
});

export const videoTokenDtoSchema = z.object({
  token: z.string(),
  roomId: z.string(),
  expiresAt: z.string().datetime(),
});

export const createConsultationRequestSchema = z.object({
  expertId: z.string().uuid(),
  title: z.string().min(1).max(200),
  note: z.string().max(1000).optional(),
});

export const submitReviewRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
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

export const callStatusDtoSchema = z.object({
  consultationId: z.string().uuid(),
  customerJoined: z.boolean(),
  expertJoined: z.boolean(),
  wasSuccessfullyConnected: z.boolean(),
  status: consultationStatusSchema,
  connectedDurationSeconds: z.number().int().nonnegative().nullable(),
});
