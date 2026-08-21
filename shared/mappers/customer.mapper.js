import { resolveMediaUrl, toIso } from "./common.js";

export function toCustomerMeDto({ profile, user, avatarUrl = null }) {
  const finalAvatarUrl = avatarUrl || resolveMediaUrl(profile.avatarMedia?.storageKey);
  return {
    id: profile.id,
    userId: user.id,
    email: user.email,
    phone: user.phone,
    firstName: profile.firstName,
    lastName: profile.lastName,
    avatarUrl: finalAvatarUrl,
    status: user.status,
    createdAt: toIso(profile.createdAt),
    updatedAt: toIso(profile.updatedAt),
  };
}

export function toSavedExpertSummaryDto(expert, { savedAt, category }) {
  return {
    id: expert.id,
    firstName: expert.firstName,
    lastName: expert.lastName,
    headline: expert.headline,
    categorySlug: category.slug,
    categoryName: category.name,
    consultationRate: expert.consultationRateCents / 100,
    currency: expert.currency,
    availabilityStatus: expert.availabilityStatus,
    rating: expert.ratingCount > 0 ? Number(expert.ratingAvg) : null,
    reviewCount: expert.ratingCount,
    savedAt: toIso(savedAt),
  };
}

export function toRecentlyViewedExpertDto(expert, { viewedAt, category }) {
  return {
    ...toSavedExpertSummaryDto(expert, { savedAt: viewedAt, category }),
    viewedAt: toIso(viewedAt),
  };
}
