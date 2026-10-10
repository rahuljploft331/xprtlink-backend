import { resolveMediaUrl, toIso } from "./common.js";

export function toCustomerMeDto({ profile, user, avatarUrl = null }) {
  const finalAvatarUrl = avatarUrl || resolveMediaUrl(profile.avatarMedia?.storageKey);
  return {
    id: profile.id,
    userId: user.id,
    email: user.email,
    phone: user.phone,
    hasPassword: Boolean(user.passwordHash),
    firstName: profile.firstName,
    lastName: profile.lastName,
    avatarUrl: finalAvatarUrl,
    status: user.status,
    createdAt: toIso(profile.createdAt),
    updatedAt: toIso(profile.updatedAt),
  };
}

export function toSavedExpertSummaryDto(expert, { savedAt, categories }) {
  const cats = categories ?? expert.categories ?? [];
  return {
    id: expert.id,
    firstName: expert.firstName,
    lastName: expert.lastName,
    headline: expert.headline,
    categories: cats.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
    consultationRate: expert.consultationRateCents / 100,
    currency: expert.currency,
    availabilityStatus: expert.availabilityStatus,
    rating: expert.ratingCount > 0 ? Number(expert.ratingAvg) : null,
    reviewCount: expert.ratingCount,
    savedAt: toIso(savedAt),
  };
}

export function toRecentlyViewedExpertDto(expert, { viewedAt, categories }) {
  return {
    ...toSavedExpertSummaryDto(expert, { savedAt: viewedAt, categories }),
    viewedAt: toIso(viewedAt),
  };
}

export function toCustomerPublicDto(profile) {
  const finalAvatarUrl = resolveMediaUrl(profile.avatarMedia?.storageKey);
  
  let isOnline = false;
  let lastActive = null;
  if (profile.user?.deviceTokens?.length > 0) {
    lastActive = profile.user.deviceTokens[0].lastSeenAt;
    const FIVE_MINUTES = 5 * 60 * 1000;
    isOnline = (Date.now() - new Date(lastActive).getTime()) < FIVE_MINUTES;
  }

  return {
    id: profile.id,
    firstName: profile.firstName,
    lastName: profile.lastName,
    avatarUrl: finalAvatarUrl,
    isOnline,
    lastActive: toIso(lastActive),
    emailVerified: Boolean(profile.user?.emailVerifiedAt),
    phoneVerified: Boolean(profile.user?.phoneVerifiedAt),
    totalConsultations: profile._count?.consultations ?? 0,
    memberSince: toIso(profile.createdAt),
  };
}
