import { centsToAmount, fullName, resolveMediaUrl, toIso } from "./common.js";

export function toCategoryRefDto(category) {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
  };
}

export function toExpertPublicDto(expert, { categories, isSaved } = {}) {
  const cats = categories ?? expert.categories ?? [];
  return {
    id: expert.id,
    firstName: expert.firstName,
    lastName: expert.lastName,
    avatarUrl: resolveMediaUrl(expert.avatarMedia?.storageKey),
    categories: cats.map(toCategoryRefDto),
    headline: expert.headline,
    bio: expert.bio,
    title: expert.title ?? null,
    businessName: expert.businessName ?? null,
    languages: expert.languages ?? [],
    serviceAreas: expert.serviceAreas ?? [],
    consultationRate: centsToAmount(expert.consultationRateCents),
    currency: expert.currency,
    experienceYears: expert.experienceYears,
    availabilityStatus: expert.availabilityStatus,
    verificationStatus: expert.verificationStatus,
    rating: expert.ratingCount > 0 ? Number(expert.ratingAvg) : null,
    reviewCount: expert.ratingCount,
    foundingMember: expert.foundingMember,
    isFeatured: expert.isFeatured ?? false,
    ...(isSaved !== undefined ? { isSaved } : {}),
  };
}

export function toExpertMeDto(expert, { user, categories, subscriptionActive = false }) {
  return {
    ...toExpertPublicDto(expert, { categories }),
    userId: user.id,
    email: user.email,
    phone: user.phone,
    onboardingStep: expert.onboardingStep,
    onboardingComplete: Boolean(expert.onboardingCompletedAt),
    searchEligible: expert.searchEligible,
    subscriptionActive,
  };
}

export function toExpertReviewDto(review, { customerFirstName }) {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    customerFirstName,
    customerLastInitial: customerFirstName?.charAt(0)?.toUpperCase() ?? "?",
    createdAt: toIso(review.createdAt),
  };
}

export function toExpertVerificationDto(verification, documents = []) {
  return {
    status: verification?.status ?? "unverified",
    submittedAt: verification ? toIso(verification.submittedAt) : null,
    reviewedAt: verification ? toIso(verification.reviewedAt) : null,
    reviewNotes: verification?.reviewNotes ?? null,
    documents: documents.map((doc) => ({
      id: doc.id,
      mediaId: doc.mediaId,
      docType: doc.docType,
      url: resolveMediaUrl(doc.media?.storageKey),
    })),
  };
}

export function toExpertDashboardDto({
  expert,
  pendingQuoteCount,
  activeConsultationCount,
  unreadNotificationCount,
  earningsThisWeekCents,
  earningsTodayCents = 0,
  earningsThisMonthCents = 0,
  subscriptionActive,
  subscription = null,
  latestQuote = null,
  latestMessage = null,
  lastCompleted = null,
}) {
  return {
    availabilityStatus: expert.availabilityStatus,
    verificationStatus: expert.verificationStatus,
    subscriptionActive,
    pendingQuoteCount,
    activeConsultationCount,
    unreadNotificationCount,
    earningsThisWeekCents,
    earningsTodayCents,
    earningsThisMonthCents,
    subscription: toDashboardSubscriptionDto(subscription),
    recentActivity: {
      newRequest: toNewRequestActivityDto(latestQuote),
      latestMessage: toLatestMessageActivityDto(latestMessage),
      lastCompleted: toLastCompletedActivityDto(lastCompleted),
    },
  };
}

function toDashboardSubscriptionDto(subscription) {
  if (!subscription) return null;
  return {
    planName: subscription.plan?.name ?? null,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: toIso(subscription.currentPeriodEnd),
  };
}

function toNewRequestActivityDto(quote) {
  if (!quote) return null;
  return {
    type: "quote",
    id: quote.id,
    title: quote.title,
    description: quote.description,
    customerName: fullName(quote.customer?.firstName, quote.customer?.lastName) || "Customer",
    status: quote.status,
    createdAt: toIso(quote.createdAt),
  };
}

function toLatestMessageActivityDto(message) {
  if (!message) return null;
  const customer = message.conversation?.customer;
  return {
    conversationId: message.conversationId,
    peerName: fullName(customer?.firstName, customer?.lastName) || "Customer",
    preview: message.body ?? null,
    createdAt: toIso(message.createdAt),
  };
}

function toLastCompletedActivityDto(consultation) {
  if (!consultation) return null;
  return {
    consultationId: consultation.id,
    customerName: fullName(consultation.customer?.firstName, consultation.customer?.lastName) || "Customer",
    endedAt: toIso(consultation.endedAt),
    rating: consultation.review?.rating ?? null,
    comment: consultation.review?.comment ?? null,
  };
}

export function toExpertSettingsDto(settings) {
  return {
    preferences: settings?.preferences ?? {},
  };
}

export function expertDisplayName(expertOrUser) {
  if (!expertOrUser) return "Expert";
  if (expertOrUser.firstName) {
    return fullName(expertOrUser.firstName, expertOrUser.lastName);
  }
  if (expertOrUser.customerProfile) {
    return fullName(
      expertOrUser.customerProfile.firstName,
      expertOrUser.customerProfile.lastName
    );
  }
  return expertOrUser.email?.split("@")[0] ?? "Expert";
}
