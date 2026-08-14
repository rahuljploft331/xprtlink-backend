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
  cancelAtPeriodEnd: z.boolean(),
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
  planId: z.string().uuid().optional(),
  planCode: z.string().optional(),
  store: z.enum(["apple", "google"]).default("apple"),
  receiptData: z.string().min(1).default("receipt_demo_token"),
});

export const payConsultationRequestSchema = z.object({
  paymentMethodId: z.string().uuid(),
  stripePaymentIntentId: z.string().startsWith("pi_").optional(),
});

export const addPaymentMethodRequestSchema = z.object({
  stripePaymentMethodId: z.string().startsWith("pm_"),
  brand: z.string().min(1).default("visa"),
  last4: z.string().length(4).default("4242"),
  expMonth: z.number().int().min(1).max(12).default(12),
  expYear: z.number().int().default(new Date().getFullYear() + 3),
  setDefault: z.boolean().optional(),
});

export const preAuthHoldRequestSchema = z.object({
  paymentMethodId: z.string().uuid(),
  estimatedCents: z.number().int().positive().optional(),
});

export const customConnectKycRequestSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.object({
    day: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(1900).max(new Date().getFullYear()),
  }),
  address: z.object({
    line1: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().length(2).default("US"),
  }),
  ssnLast4: z.string().length(4),
  frontDocumentFileId: z.string().min(1).optional(),
  backDocumentFileId: z.string().min(1).optional(),
  userIpAddress: z.string().optional(),
});

export const attachBankAccountRequestSchema = z.object({
  routingNumber: z.string().min(1),
  accountNumber: z.string().min(1),
  accountHolderName: z.string().min(1),
});

