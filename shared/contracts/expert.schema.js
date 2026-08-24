import { z } from "zod";

export const categoryRefDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
});

export const expertPublicDtoSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  category: categoryRefDtoSchema,
  headline: z.string().nullable(),
  bio: z.string().nullable(),
  title: z.string().nullable(),
  businessName: z.string().nullable(),
  languages: z.array(z.string()),
  serviceAreas: z.array(z.string()),
  consultationRate: z.number(),
  currency: z.string().length(3),
  experienceYears: z.number().int().nonnegative(),
  availabilityStatus: z.enum(["online", "offline", "busy"]),
  verificationStatus: z.enum([
    "unverified",
    "pending",
    "approved",
    "rejected",
    "resubmit_required",
  ]),
  rating: z.number().nullable(),
  reviewCount: z.number().int().nonnegative(),
  foundingMember: z.boolean(),
  isSaved: z.boolean().optional(),
});

export const expertMeDtoSchema = expertPublicDtoSchema.extend({
  userId: z.string().uuid(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  onboardingStep: z.number().int().nonnegative(),
  onboardingComplete: z.boolean(),
  searchEligible: z.boolean(),
  subscriptionActive: z.boolean(),
});

export const expertMeUpdateRequestSchema = z.object({
  headline: z.string().max(200).optional(),
  bio: z.string().optional(),
  title: z.string().max(200).optional(),
  businessName: z.string().max(200).optional(),
  languages: z.array(z.string().max(50)).max(20).optional(),
  serviceAreas: z.array(z.string().max(100)).max(30).optional(),
  consultationRate: z.number().positive().optional(),
  experienceYears: z.number().int().nonnegative().optional(),
  availabilityStatus: z.enum(["online", "offline", "busy"]).optional(),
  categoryId: z.string().uuid().optional(),
  avatarMediaId: z.string().uuid().optional(),
});

export const expertReviewDtoSchema = z.object({
  id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  customerFirstName: z.string(),
  customerLastInitial: z.string(),
  createdAt: z.string().datetime(),
});

export const expertRatingSummaryDtoSchema = z.object({
  averageRating: z.number(),
  reviewCount: z.number().int().nonnegative(),
  distribution: z.object({
    five: z.number().int().nonnegative(),
    four: z.number().int().nonnegative(),
    three: z.number().int().nonnegative(),
    two: z.number().int().nonnegative(),
    one: z.number().int().nonnegative(),
  }),
});

export const expertDashboardDtoSchema = z.object({
  availabilityStatus: z.enum(["online", "offline", "busy"]),
  verificationStatus: z.string(),
  subscriptionActive: z.boolean(),
  pendingQuoteCount: z.number().int().nonnegative(),
  activeConsultationCount: z.number().int().nonnegative(),
  unreadNotificationCount: z.number().int().nonnegative(),
  earningsThisWeekCents: z.number().int().nonnegative(),
});

export const expertVerificationDtoSchema = z.object({
  status: z.enum([
    "unverified",
    "pending",
    "approved",
    "rejected",
    "resubmit_required",
  ]),
  submittedAt: z.string().datetime().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  reviewNotes: z.string().nullable(),
  documents: z.array(
    z.object({
      id: z.string().uuid(),
      mediaId: z.string().uuid(),
      docType: z.enum(["government_id", "credential", "other"]),
      url: z.string().url().nullable(),
    })
  ),
});

export const expertSettingsDtoSchema = z.object({
  preferences: z.record(z.unknown()),
});

// ─── Request Schemas (input validation) ───────────────────────────────────────

export const expertOnboardingRequestSchema = z.object({
  headline: z.string().max(200).optional(),
  bio: z.string().max(5000).optional(),
  title: z.string().max(200).optional(),
  businessName: z.string().max(200).optional(),
  languages: z.array(z.string().max(50)).max(20).optional(),
  serviceAreas: z.array(z.string().max(100)).max(30).optional(),
  consultationRate: z.number().positive().optional(),
  experienceYears: z.number().int().nonnegative().optional(),
  categoryId: z.string().uuid().optional(),
  avatarMediaId: z.string().uuid().nullable().optional(),
});

export const expertSettingsUpdateRequestSchema = z.object({
  preferences: z
    .record(z.unknown())
    .refine((val) => JSON.stringify(val).length <= 10_000, {
      message: "Preferences payload too large (max 10KB)",
    }),
});

export const expertVerificationDocumentsRequestSchema = z.object({
  primaryId: z.string().uuid({ message: "primaryId must be a valid UUID" }),
  secondaryId: z.string().uuid({ message: "secondaryId must be a valid UUID" }).optional(),
  docType: z.enum(["government_id", "credential", "other"]).default("government_id"),
});
