import { z } from "zod";

// ─── Shared sub-schemas ───────────────────────────────────────────────────────

export const serviceAreaLocationSchema = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

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
  serviceAreas: z.array(serviceAreaLocationSchema),
  consultationRate: z.number(),
  currency: z.string().length(3),
  experienceYears: z.number().int().nonnegative(),
  availabilityStatus: z.enum(["online", "offline", "busy"]),
  verificationStatus: z.enum([
    "unverified",
    "pending",
    "in_progress",
    "approved",
    "rejected",
    "resubmit_required",
  ]),
  rating: z.number().nullable(),
  reviewCount: z.number().int().nonnegative(),
  foundingMember: z.boolean(),
  isFeatured: z.boolean().optional(),
  isSaved: z.boolean().optional(),
});

export const adminSetFeaturedSchema = z.object({
  isFeatured: z.boolean(),
  featuredRank: z.number().int().positive().nullable().optional(),
  featuredUntil: z.string().datetime().nullable().optional(),
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
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  headline: z.string().max(200).optional(),
  bio: z.string().optional(),
  title: z.string().max(200).optional(),
  businessName: z.string().max(200).optional(),
  languages: z.array(z.string().max(50)).max(20).optional(),
  serviceAreas: z.array(serviceAreaLocationSchema).max(20).optional(),
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

export const dashboardSubscriptionDtoSchema = z.object({
  planName: z.string().nullable(),
  status: z.string(),
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEnd: z.string().datetime().nullable(),
});

export const dashboardNewRequestActivityDtoSchema = z.object({
  type: z.literal("quote"),
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  customerName: z.string(),
  status: z.string(),
  createdAt: z.string().datetime().nullable(),
});

export const dashboardLatestMessageActivityDtoSchema = z.object({
  conversationId: z.string().uuid(),
  peerName: z.string(),
  preview: z.string().nullable(),
  createdAt: z.string().datetime().nullable(),
});

export const dashboardLastCompletedActivityDtoSchema = z.object({
  consultationId: z.string().uuid(),
  customerName: z.string(),
  endedAt: z.string().datetime().nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  comment: z.string().nullable(),
});

export const expertDashboardDtoSchema = z.object({
  availabilityStatus: z.enum(["online", "offline", "busy"]),
  verificationStatus: z.string(),
  subscriptionActive: z.boolean(),
  pendingQuoteCount: z.number().int().nonnegative(),
  activeConsultationCount: z.number().int().nonnegative(),
  unreadNotificationCount: z.number().int().nonnegative(),
  earningsThisWeekCents: z.number().int().nonnegative(),
  earningsTodayCents: z.number().int().nonnegative(),
  earningsThisMonthCents: z.number().int().nonnegative(),
  subscription: dashboardSubscriptionDtoSchema.nullable(),
  recentActivity: z.object({
    newRequest: dashboardNewRequestActivityDtoSchema.nullable(),
    latestMessage: dashboardLatestMessageActivityDtoSchema.nullable(),
    lastCompleted: dashboardLastCompletedActivityDtoSchema.nullable(),
  }),
});

export const expertVerificationDtoSchema = z.object({
  status: z.enum([
    "unverified",
    "pending",
    "in_progress",
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
  serviceAreas: z.array(serviceAreaLocationSchema).max(20).optional(),
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
