import { z } from "zod";

export const paymentMethodDtoSchema = z.object({
  id: z.string().uuid(),
  brand: z.string(),
  last4: z.string().length(4),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int(),
  isDefault: z.boolean(),
});

export const transactionDtoSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["consultation_charge", "subscription", "refund"]),
  amount: z.number(),
  currency: z.string().length(3),
  status: z.enum(["pending", "succeeded", "failed", "refunded"]),
  createdAt: z.string().datetime(),
});

export const subscriptionPlanDtoSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  priceMonthly: z.number(),
  currency: z.string().length(3),
  visibilityBoost: z.enum(["listing", "top_25", "top_5"]),
});

export const expertSubscriptionDtoSchema = z.object({
  id: z.string().uuid(),
  plan: subscriptionPlanDtoSchema,
  store: z.enum(["apple", "google"]),
  status: z.enum(["active", "expired", "cancelled", "grace_period"]),
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  cancelledAt: z.string().datetime().nullable(),
});

export const earningsEntryDtoSchema = z.object({
  id: z.string().uuid(),
  consultationId: z.string().uuid(),
  grossAmount: z.number(),
  commissionAmount: z.number(),
  netAmount: z.number(),
  currency: z.string().length(3),
  createdAt: z.string().datetime(),
});

export const subscribeRequestSchema = z.object({
  planId: z.string().uuid(),
  store: z.enum(["apple", "google"]),
  receiptData: z.string().min(1),
});

export const payConsultationRequestSchema = z.object({
  paymentMethodId: z.string().uuid(),
});
