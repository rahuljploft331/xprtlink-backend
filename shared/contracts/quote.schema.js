import { z } from "zod";

export const quoteStatusSchema = z.enum([
  "draft",
  "submitted",
  "pending_expert_review",
  "expert_reviewed",
  "quoted",
  "accepted",
  "rejected",
  "expired",
  "canceled",
]);

export const quoteAttachmentDtoSchema = z.object({
  id: z.string().uuid(),
  mediaId: z.string().uuid(),
  url: z.string().url().nullable(),
  mimeType: z.string().nullable(),
});

export const quoteStatusEventDtoSchema = z.object({
  id: z.string().uuid(),
  fromStatus: quoteStatusSchema.nullable(),
  toStatus: quoteStatusSchema,
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const expertQuoteBlockDtoSchema = z.object({
  amount: z.number(),
  currency: z.string().length(3),
  notes: z.string().nullable(),
  timeline: z.string().nullable(),
  quotedAt: z.string().datetime(),
});

export const quoteSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  referenceNumber: z.string().nullable(),
  title: z.string(),
  category: z.string().nullable(),
  status: quoteStatusSchema,
  expertId: z.string().uuid(),
  expertName: z.string(),
  expertAvatarUrl: z.string().url().nullable(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  budget: z.number().nullable(),
  currency: z.string().length(3),
  attachmentCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const quoteDetailDtoSchema = z.object({
  id: z.string().uuid(),
  referenceNumber: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  notes: z.string().nullable(),
  category: z.string().nullable(),
  preferredLocation: z.string().nullable(),
  status: quoteStatusSchema,
  budget: z.number().nullable(),
  currency: z.string().length(3),
  expertId: z.string().uuid(),
  expertName: z.string(),
  expertTitle: z.string().nullable(),
  expertHeadline: z.string().nullable(),
  expertAvatarUrl: z.string().url().nullable(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  contactName: z.string(),
  contactPhone: z.string().nullable(),
  customerAvatarUrl: z.string().url().nullable(),
  attachments: z.array(quoteAttachmentDtoSchema),
  expertQuote: expertQuoteBlockDtoSchema.nullable(),
  expiresAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const quoteHistoryDtoSchema = z.object({
  quoteId: z.string().uuid(),
  events: z.array(quoteStatusEventDtoSchema),
});

export const createQuoteRequestSchema = z.object({
  expertId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  category: z.string().min(1).max(120).optional(),
  preferredLocation: z.string().min(1).max(200).optional(),
  budget: z.number().positive().optional(),
  notes: z.string().optional(),
  mediaIds: z.array(z.string().uuid()).optional(),
});

export const updateQuoteRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).optional(),
  category: z.string().min(1).max(120).optional(),
  preferredLocation: z.string().min(1).max(200).optional(),
  budget: z.number().positive().optional(),
  mediaIds: z.array(z.string().uuid()).optional(),
  notes: z.string().optional(),
});

export const submitQuotationRequestSchema = z.object({
  amount: z.number().positive(),
  timeline: z.string().min(1).max(120).optional(),
  notes: z.string().optional(),
});
