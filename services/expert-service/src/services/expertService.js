import { getDb } from "@xprtlink/shared/db";
import {
  toExpertPublicDto,
  toExpertMeDto,
  toExpertReviewDto,
  toExpertVerificationDto,
  toExpertDashboardDto,
  toExpertSettingsDto,
} from "@xprtlink/shared/mappers/expert.mapper.js";
import { amountToCents } from "@xprtlink/shared/mappers/common.js";
import { badRequest, notFound, unauthorized } from "@xprtlink/shared/utils/errors.js";
import { parsePagination, paginatedResult } from "@xprtlink/shared/utils/pagination.js";

const PUBLIC_WHERE = { searchEligible: true, verificationStatus: "approved" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Expert ids are UUIDs. Guard lookups so malformed ids (from bots/scanners)
// return a clean 404 instead of surfacing a Prisma P2023 stack trace.
function assertExpertId(id) {
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw notFound("Expert not found");
  }
}

// Rank of each subscription visibility boost for featured ordering (higher = better).
// Mirrors SubscriptionPlan.visibilityBoost (listing | top_25 | top_5) → Core / Professional / Elite.
const VISIBILITY_BOOST_RANK = { top_5: 3, top_25: 2, listing: 1 };

function activeBoostRank(expert) {
  const boost = expert.subscriptions?.[0]?.plan?.visibilityBoost;
  return VISIBILITY_BOOST_RANK[boost] ?? 0;
}

/**
 * Featured experts (MFS §9.7.3, CUS-HOME-003).
 *
 * Selection is configurable rather than hardcoded:
 *  1. Admin/manually promoted experts (`isFeatured`, not expired) ordered by `featuredRank`.
 *  2. Backfilled by active subscription tier (Elite > Professional > Core) when fewer
 *     than `limit` experts are explicitly featured.
 * Rating / founding-member are only tiebreakers. All candidates must still satisfy
 * marketplace eligibility (approved + search-eligible) and also appear in normal search.
 */
export async function getFeatured(limit = 10) {
  const db = getDb();
  const now = new Date();
  const include = {
    categories: true,
    avatarMedia: true,
    subscriptions: {
      where: { status: "active" },
      take: 1,
      include: { plan: { select: { visibilityBoost: true } } },
    },
  };

  // 1. Admin-pinned featured experts (respecting optional expiry), ordered by rank.
  const pinned = await db.expertProfile.findMany({
    where: {
      ...PUBLIC_WHERE,
      isFeatured: true,
      OR: [{ featuredUntil: null }, { featuredUntil: { gt: now } }],
    },
    take: limit,
    orderBy: [
      { featuredRank: "asc" },
      { ratingAvg: "desc" },
      { foundingMember: "desc" },
    ],
    include,
  });

  let selected = pinned;

  // 2. Backfill by subscription tier when there aren't enough pinned experts.
  if (pinned.length < limit) {
    const backfill = await db.expertProfile.findMany({
      where: {
        ...PUBLIC_WHERE,
        id: { notIn: pinned.map((e) => e.id) },
      },
      // Over-fetch, then sort by tier (boost) in memory since visibilityBoost lives on the plan.
      take: (limit - pinned.length) * 5,
      orderBy: [{ ratingAvg: "desc" }, { foundingMember: "desc" }],
      include,
    });

    backfill.sort((a, b) => {
      const boostDiff = activeBoostRank(b) - activeBoostRank(a);
      if (boostDiff !== 0) return boostDiff;
      return Number(b.ratingAvg) - Number(a.ratingAvg);
    });

    selected = [...pinned, ...backfill.slice(0, limit - pinned.length)];
  }

  return selected.map((e) => toExpertPublicDto(e, { categories: e.categories }));
}

/**
 * Trending experts (Placeholder logic).
 * Currently reuses getFeatured() logic as requested by the client,
 * to be updated later with actual trending calculation (e.g. by activity/popularity).
 */
export async function getTrending(limit = 10) {
  return getFeatured(limit);
}


export async function searchExperts(query, auth) {
  const { page, limit, skip } = parsePagination(query);
  const where = { ...PUBLIC_WHERE };

  if (query.category) {
    // Match experts linked to the given category slug (many-to-many).
    where.categories = { some: { slug: query.category } };
  }
  if (query.priceMin) where.consultationRateCents = { gte: amountToCents(Number(query.priceMin)) };
  if (query.priceMax) {
    where.consultationRateCents = { ...(where.consultationRateCents || {}), lte: amountToCents(Number(query.priceMax)) };
  }
  if (query.rating) where.ratingAvg = { gte: Number(query.rating) };
  if (query.experience) where.experienceYears = { gte: Number(query.experience) };
  if (query.experienceMax) {
    where.experienceYears = { ...(where.experienceYears || {}), lte: Number(query.experienceMax) };
  }
  if (query.online === "true") {
    where.availabilityStatus = "online";
  } else if (query.online === "false") {
    where.availabilityStatus = { not: "online" };
  }
  if (query.verified === "true") where.verificationStatus = "approved";

  if (query.q) {
    where.OR = [
      { firstName: { contains: query.q, mode: "insensitive" } },
      { lastName: { contains: query.q, mode: "insensitive" } },
      { headline: { contains: query.q, mode: "insensitive" } },
      { bio: { contains: query.q, mode: "insensitive" } },
      { title: { contains: query.q, mode: "insensitive" } },
    ];
  }

  // Location filter: lat, lng, radius (km) — uses Haversine post-filter on serviceAreas Json
  const hasLocationFilter = query.lat && query.lng;
  const customerLat = hasLocationFilter ? Number(query.lat) : null;
  const customerLng = hasLocationFilter ? Number(query.lng) : null;
  const radiusKm = hasLocationFilter ? Number(query.radius || 50) : null; // default 50km

  const orderBy = buildSort(query.sort);

  const db = getDb();

  if (hasLocationFilter) {
    // For geo filtering, fetch all matching experts (without pagination) then post-filter by distance
    const allExperts = await db.expertProfile.findMany({
      where,
      orderBy,
      include: { categories: true, avatarMedia: true },
    });

    // Filter experts who have at least one serviceArea within the radius
    const filtered = allExperts.filter((expert) => {
      const areas = expert.serviceAreas;
      if (!Array.isArray(areas) || areas.length === 0) return false;
      return areas.some((area) =>
        haversineKm(customerLat, customerLng, area.lat, area.lng) <= radiusKm
      );
    });

    // Sort by nearest service area distance
    filtered.sort((a, b) => {
      const distA = nearestDistance(customerLat, customerLng, a.serviceAreas);
      const distB = nearestDistance(customerLat, customerLng, b.serviceAreas);
      return distA - distB;
    });

    const total = filtered.length;
    const paged = filtered.slice(skip, skip + limit);

    let savedIds = new Set();
    if (auth?.customerProfileId) {
      const saved = await db.customerSavedExpert.findMany({
        where: { customerProfileId: auth.customerProfileId, expertProfileId: { in: paged.map((e) => e.id) } },
      });
      savedIds = new Set(saved.map((s) => s.expertProfileId));
    }

    const items = paged.map((e) => ({
      ...toExpertPublicDto(e, { categories: e.categories, isSaved: savedIds.has(e.id) }),
      distance: Math.round(nearestDistance(customerLat, customerLng, e.serviceAreas) * 10) / 10,
    }));
    return paginatedResult(items, { page, limit, total });
  }

  // Standard non-geo search with DB-level pagination
  const [experts, total] = await Promise.all([
    db.expertProfile.findMany({ where, skip, take: limit, orderBy, include: { categories: true, avatarMedia: true } }),
    db.expertProfile.count({ where }),
  ]);

  let savedIds = new Set();
  if (auth?.customerProfileId) {
    const saved = await db.customerSavedExpert.findMany({
      where: { customerProfileId: auth.customerProfileId, expertProfileId: { in: experts.map((e) => e.id) } },
    });
    savedIds = new Set(saved.map((s) => s.expertProfileId));
  }

  const items = experts.map((e) =>
    toExpertPublicDto(e, { categories: e.categories, isSaved: savedIds.has(e.id) })
  );
  return paginatedResult(items, { page, limit, total });
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * (Math.PI / 180); }

function nearestDistance(lat, lng, serviceAreas) {
  if (!Array.isArray(serviceAreas) || serviceAreas.length === 0) return Infinity;
  return Math.min(...serviceAreas.map((a) => haversineKm(lat, lng, a.lat, a.lng)));
}

function buildSort(sort) {
  switch (sort) {
    case "rating": return { ratingAvg: "desc" };
    case "price_asc": return { consultationRateCents: "asc" };
    case "price_desc": return { consultationRateCents: "desc" };
    case "experience": return { experienceYears: "desc" };
    case "availability": return { availabilityStatus: "asc" };
    default: return [{ foundingMember: "desc" }, { ratingAvg: "desc" }];
  }
}

export async function getExpertById(id, auth) {
  assertExpertId(id);
  const expert = await getDb().expertProfile.findUnique({
    where: { id },
    include: { categories: true, avatarMedia: true },
  });
  if (!expert) throw notFound("Expert not found");

  let isSaved;
  if (auth?.customerProfileId) {
    const saved = await getDb().customerSavedExpert.findFirst({
      where: { customerProfileId: auth.customerProfileId, expertProfileId: id },
    });
    isSaved = Boolean(saved);

    // Record recently viewed (fire-and-forget — don't block the response)
    getDb().customerRecentlyViewed.upsert({
      where: {
        customerProfileId_expertProfileId: {
          customerProfileId: auth.customerProfileId,
          expertProfileId: id,
        },
      },
      create: { customerProfileId: auth.customerProfileId, expertProfileId: id },
      update: { viewedAt: new Date() },
    }).catch((err) => {
      console.error(`[getExpertById] Failed to record recently viewed for expert ${id}:`, err.message);
    });
  }
  return toExpertPublicDto(expert, { categories: expert.categories, isSaved });
}

export async function getExpertReviews(id, query) {
  assertExpertId(id);
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();
  const [reviews, total] = await Promise.all([
    db.review.findMany({
      where: { expertId: id, status: "published" },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { customer: true },
    }),
    db.review.count({ where: { expertId: id, status: "published" } }),
  ]);
  const items = reviews.map((r) =>
    toExpertReviewDto(r, { customerFirstName: r.customer.firstName })
  );
  return paginatedResult(items, { page, limit, total });
}

export async function getExpertAvailability(id) {
  assertExpertId(id);
  const expert = await getDb().expertProfile.findUnique({ where: { id } });
  if (!expert) throw notFound("Expert not found");
  return {
    expertId: id,
    availabilityStatus: expert.availabilityStatus,
    callable: expert.availabilityStatus === "online" && expert.searchEligible,
  };
}

async function getExpertProfileOrThrow(auth) {
  const expert = await getDb().expertProfile.findFirst({
    where: { userId: auth.userId },
    include: {
      categories: true,
      avatarMedia: true,
      subscriptions: { where: { status: "active" }, take: 1 },
      settings: true,
    },
  });
  if (!expert) throw notFound("Expert profile not found");
  const user = await getDb().user.findUnique({ where: { id: auth.userId } });
  // subscriptionActive is true when expert has an active subscription,
  // including those scheduled to cancel at period end (access remains until currentPeriodEnd)
  const subscriptionActive = expert.subscriptions.length > 0;
  return { expert, user, subscriptionActive };

}

export async function getExpertMe(auth) {
  const { expert, user, subscriptionActive } = await getExpertProfileOrThrow(auth);
  return toExpertMeDto(expert, { user, categories: expert.categories, subscriptionActive });
}

export async function updateExpertMe(auth, body) {
  const { expert, user, subscriptionActive } = await getExpertProfileOrThrow(auth);
  
  if (body.avatarMediaId) {
    const media = await getDb().mediaAsset.findFirst({
      where: { id: body.avatarMediaId, ownerUserId: auth.userId, status: "ready" }
    });
    if (!media) throw badRequest("Invalid or unready avatar media asset");
  }

  // Resolve categories when provided: must be a non-empty set of active categories.
  const categoryConnect = await resolveCategoryConnect(body.categoryIds);

  const updated = await getDb().expertProfile.update({
    where: { id: expert.id },
    data: {
      ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
      ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
      ...(body.headline !== undefined ? { headline: body.headline } : {}),
      ...(body.bio !== undefined ? { bio: body.bio } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.businessName !== undefined ? { businessName: body.businessName } : {}),
      ...(body.languages !== undefined ? { languages: body.languages } : {}),
      ...(body.serviceAreas !== undefined ? { serviceAreas: body.serviceAreas } : {}),
      ...(body.consultationRate !== undefined
        ? { consultationRateCents: amountToCents(body.consultationRate) }
        : {}),
      ...(body.experienceYears !== undefined ? { experienceYears: body.experienceYears } : {}),
      ...(body.availabilityStatus ? { availabilityStatus: body.availabilityStatus } : {}),
      ...(categoryConnect ? { categories: { set: categoryConnect } } : {}),
      ...(body.avatarMediaId !== undefined ? { avatarMediaId: body.avatarMediaId } : {}),
    },
    include: { categories: true, avatarMedia: true, subscriptions: { where: { status: "active" }, take: 1 } },
  });
  return toExpertMeDto(updated, {
    user,
    categories: updated.categories,
    subscriptionActive,
  });
}

/**
 * Validate a categoryIds array and return a Prisma connect/set list ([{ id }]).
 * Returns null when categoryIds is not provided (caller leaves the relation
 * untouched). Throws when the array is empty or references missing/inactive
 * categories — experts must always have at least one valid category.
 */
export async function resolveCategoryConnect(categoryIds) {
  if (categoryIds === undefined) return null;
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
    throw badRequest("At least one category is required", "VALIDATION_ERROR", "categoryIds");
  }
  const unique = [...new Set(categoryIds)];
  const found = await getDb().category.findMany({
    where: { id: { in: unique }, isActive: true },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw badRequest("One or more categories are invalid or inactive", "VALIDATION_ERROR", "categoryIds");
  }
  return unique.map((id) => ({ id }));
}

export async function submitOnboarding(auth, body) {
  const db = getDb();
  const expert = await db.expertProfile.findFirst({ where: { userId: auth.userId } });
  if (!expert) throw notFound("Expert profile not found");

  // Validate avatar if provided
  if (body.avatarMediaId) {
    const media = await db.mediaAsset.findFirst({
      where: { id: body.avatarMediaId, ownerUserId: auth.userId, status: "ready" }
    });
    if (!media) throw badRequest("Invalid or unready avatar media asset");
  }

  // Resolve categories when provided (must be a non-empty set of active categories).
  const categoryConnect = await resolveCategoryConnect(body.categoryIds);

  await db.$transaction(async (tx) => {
    // Save profile data + mark onboarding complete in one shot
    await tx.expertProfile.update({
      where: { id: expert.id },
      data: {
        ...(body.headline !== undefined ? { headline: body.headline } : {}),
        ...(body.bio !== undefined ? { bio: body.bio } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.businessName !== undefined ? { businessName: body.businessName } : {}),
        ...(body.languages !== undefined ? { languages: body.languages } : {}),
        ...(body.serviceAreas !== undefined ? { serviceAreas: body.serviceAreas } : {}),
        ...(body.consultationRate !== undefined
          ? { consultationRateCents: amountToCents(body.consultationRate) }
          : {}),
        ...(body.experienceYears !== undefined ? { experienceYears: body.experienceYears } : {}),
        ...(categoryConnect ? { categories: { set: categoryConnect } } : {}),
        ...(body.avatarMediaId !== undefined ? { avatarMediaId: body.avatarMediaId } : {}),
        onboardingCompletedAt: new Date(),
        verificationStatus: "pending",
      },
    });

    const existing = await tx.expertVerification.findFirst({
      where: { expertProfileId: expert.id },
      orderBy: { submittedAt: "desc" },
    });
    if (existing) {
      await tx.expertVerification.update({
        where: { id: existing.id },
        data: { status: "pending", submittedAt: new Date() },
      });
    } else {
      await tx.expertVerification.create({
        data: { expertProfileId: expert.id, status: "pending" },
      });
    }
  });

  return { submitted: true };
}

export async function getVerification(auth) {
  const expert = await getDb().expertProfile.findFirst({ where: { userId: auth.userId } });
  if (!expert) throw notFound("Expert profile not found");
  const verification = await getDb().expertVerification.findFirst({
    where: { expertProfileId: expert.id },
    orderBy: { submittedAt: "desc" },
    include: { documents: { include: { media: true } } },
  });
  return toExpertVerificationDto(verification, verification?.documents ?? []);
}

export async function submitVerificationDocuments(auth, body) {
  const db = getDb();
  const expert = await db.expertProfile.findFirst({ where: { userId: auth.userId } });
  if (!expert) throw notFound("Expert profile not found");

  // Validate submitted media IDs — must exist, belong to this user, and be ready
  const docIds = [];
  if (body.primaryId) docIds.push(body.primaryId);
  if (body.secondaryId) docIds.push(body.secondaryId);

  if (docIds.length === 0) {
    throw badRequest("At least one document (primaryId) is required", "VALIDATION_ERROR", "primaryId");
  }

  const mediaAssets = await db.mediaAsset.findMany({
    where: {
      id: { in: docIds },
      ownerUserId: auth.userId,
      status: "ready",
    },
  });

  if (mediaAssets.length !== docIds.length) {
    const foundIds = new Set(mediaAssets.map((m) => m.id));
    const missing = docIds.filter((id) => !foundIds.has(id));
    throw badRequest(
      `Document media asset(s) not found or not ready: ${missing.join(", ")}`,
      "INVALID_MEDIA",
      "primaryId"
    );
  }

  await db.$transaction(async (tx) => {
    let verification = await tx.expertVerification.findFirst({
      where: { expertProfileId: expert.id },
      orderBy: { submittedAt: "desc" },
    });
    if (!verification) {
      verification = await tx.expertVerification.create({
        data: { expertProfileId: expert.id, status: "in_progress" },
      });
    } else {
      await tx.expertVerification.update({
        where: { id: verification.id },
        data: { status: "in_progress", submittedAt: new Date() },
      });
    }

    for (const media of mediaAssets) {
      await tx.expertVerificationDocument.create({
        data: {
          verificationId: verification.id,
          mediaId: media.id,
          docType: body.docType || "government_id",
        },
      });
    }

    // Documents uploaded successfully — verification is now in review.
    await tx.expertProfile.update({
      where: { id: expert.id },
      data: { verificationStatus: "in_progress" },
    });
  });

  return {
    submitted: true,
    documentCount: docIds.length,
    primaryId: docIds[0],
    secondaryId: docIds[1] || null,
  };
}


export async function getDashboard(auth) {
  const { expert, subscriptionActive } = await getExpertProfileOrThrow(auth);
  const db = getDb();

  const now = new Date();
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    pendingQuoteCount,
    activeConsultationCount,
    unreadNotificationCount,
    earningsWeek,
    earningsToday,
    earningsMonth,
    subscription,
    latestQuote,
    latestMessage,
    lastCompleted,
    lifetimeEarnings,
    totalConsultationsCompleted,
    consultationsThisMonth,
    satisfactionReviews,
    recentEarningsLedger,
  ] = await Promise.all([
    db.quoteRequest.count({
      where: { expertId: expert.id, status: { in: ["pending_expert_review", "submitted"] } },
    }),
    db.consultation.count({
      where: { expertId: expert.id, status: { in: ["requested", "ringing", "accepted", "in_progress"] } },
    }),
    // clearedAt must be excluded here too — notifications are soft-deleted, and a
    // cleared item must not keep the dashboard badge lit (see notification-service).
    db.notification.count({ where: { userId: auth.userId, readAt: null, clearedAt: null } }),
    db.expertEarningsLedger.aggregate({
      where: { expertProfileId: expert.id, createdAt: { gte: startOfWeek } },
      _sum: { netCents: true },
    }),
    db.expertEarningsLedger.aggregate({
      where: { expertProfileId: expert.id, createdAt: { gte: startOfDay } },
      _sum: { netCents: true },
    }),
    db.expertEarningsLedger.aggregate({
      where: { expertProfileId: expert.id, createdAt: { gte: startOfMonth } },
      _sum: { netCents: true },
    }),
    // Active subscription (with plan) for the subscription card
    db.expertSubscription.findFirst({
      where: { expertProfileId: expert.id, status: "active" },
      orderBy: { createdAt: "desc" },
      include: { plan: { select: { name: true } } },
    }),
    // Recent Activity → NEW REQUEST: latest quote received but not yet reviewed/accepted
    db.quoteRequest.findFirst({
      where: { expertId: expert.id, status: { in: ["pending_expert_review", "submitted"] } },
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { firstName: true, lastName: true } } },
    }),
    // Recent Activity → LATEST MESSAGE: latest inbound message across this expert's conversations
    db.message.findFirst({
      where: {
        senderUserId: { not: auth.userId },
        conversation: { expertId: expert.id },
      },
      orderBy: { createdAt: "desc" },
      include: {
        conversation: { include: { customer: { select: { firstName: true, lastName: true } } } },
      },
    }),
    // Recent Activity → COMPLETED: last finished call (with review if present)
    db.consultation.findFirst({
      where: { expertId: expert.id, status: "completed" },
      orderBy: { endedAt: "desc" },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        review: { select: { rating: true, comment: true } },
      },
    }),
    db.expertEarningsLedger.aggregate({
      where: { expertProfileId: expert.id },
      _sum: { netCents: true },
    }),
    db.consultation.count({
      where: { expertId: expert.id, status: "completed" },
    }),
    db.consultation.count({
      where: { expertId: expert.id, status: "completed", endedAt: { gte: startOfMonth } },
    }),
    // Satisfaction: count total published reviews and those with rating >= 4
    db.review.findMany({
      where: { expertId: expert.id, status: "published" },
      select: { rating: true },
    }),
    db.expertEarningsLedger.findMany({
      where: { expertProfileId: expert.id, createdAt: { gte: new Date(startOfDay.getTime() - 6 * 24 * 60 * 60 * 1000) } },
      select: { netCents: true, createdAt: true },
    }),
  ]);

  const earningsTrend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(startOfDay);
    d.setDate(d.getDate() - i);
    const endOfThatDay = new Date(d);
    endOfThatDay.setDate(endOfThatDay.getDate() + 1);

    const sumCents = recentEarningsLedger
      .filter((e) => e.createdAt >= d && e.createdAt < endOfThatDay)
      .reduce((acc, curr) => acc + curr.netCents, 0);

    earningsTrend.push({
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      netIncomeCents: sumCents,
    });
  }

  // Satisfaction rate: % of published reviews with rating >= 4
  const totalReviews = satisfactionReviews.length;
  const positiveReviews = satisfactionReviews.filter((r) => r.rating >= 4).length;
  const satisfactionRate = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : null;

  return toExpertDashboardDto({
    expert,
    pendingQuoteCount,
    activeConsultationCount,
    unreadNotificationCount,
    earningsThisWeekCents: earningsWeek._sum.netCents ?? 0,
    earningsTodayCents: earningsToday._sum.netCents ?? 0,
    earningsThisMonthCents: earningsMonth._sum.netCents ?? 0,
    lifetimeEarningsCents: lifetimeEarnings._sum.netCents ?? 0,
    totalConsultationsCompleted,
    consultationsThisMonth,
    satisfactionRate,
    earningsTrend,
    subscriptionActive,
    subscription,
    latestQuote,
    latestMessage,
    lastCompleted,
  });
}

export async function getRatingSummary(auth) {
  const expert = await getDb().expertProfile.findFirst({ where: { userId: auth.userId } });
  if (!expert) throw notFound("Expert profile not found");
  const reviews = await getDb().review.groupBy({
    by: ["rating"],
    where: { expertId: expert.id, status: "published" },
    _count: true,
  });
  const dist = { five: 0, four: 0, three: 0, two: 0, one: 0 };
  for (const r of reviews) {
    if (r.rating === 5) dist.five = r._count;
    if (r.rating === 4) dist.four = r._count;
    if (r.rating === 3) dist.three = r._count;
    if (r.rating === 2) dist.two = r._count;
    if (r.rating === 1) dist.one = r._count;
  }
  return {
    averageRating: Number(expert.ratingAvg),
    reviewCount: expert.ratingCount,
    distribution: dist,
  };
}

export async function getMyReviews(auth, query) {
  const expert = await getDb().expertProfile.findFirst({ where: { userId: auth.userId } });
  if (!expert) throw notFound("Expert profile not found");
  return getExpertReviews(expert.id, query);
}

export async function getSettings(auth) {
  const { expert } = await getExpertProfileOrThrow(auth);
  return toExpertSettingsDto(expert.settings);
}

export async function updateSettings(auth, body) {
  const expert = await getDb().expertProfile.findFirst({
    where: { userId: auth.userId },
    include: { settings: true },
  });
  if (!expert) throw notFound("Expert profile not found");
  const settings = await getDb().expertSettings.upsert({
    where: { expertProfileId: expert.id },
    create: { expertProfileId: expert.id, preferences: body.preferences || {} },
    update: { preferences: body.preferences || {} },
  });
  return toExpertSettingsDto(settings);
}
