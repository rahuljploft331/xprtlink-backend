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

export async function getFeatured(limit = 10) {
  const experts = await getDb().expertProfile.findMany({
    where: PUBLIC_WHERE,
    take: limit,
    orderBy: [{ ratingAvg: "desc" }, { foundingMember: "desc" }],
    include: { category: true, avatarMedia: true },
  });
  return experts.map((e) => toExpertPublicDto(e, { category: e.category }));
}

export async function searchExperts(query, auth) {
  const { page, limit, skip } = parsePagination(query);
  const where = { ...PUBLIC_WHERE };

  if (query.category) {
    const cat = await getDb().category.findFirst({ where: { slug: query.category } });
    if (cat) where.categoryId = cat.id;
  }
  if (query.priceMin) where.consultationRateCents = { gte: amountToCents(Number(query.priceMin)) };
  if (query.priceMax) {
    where.consultationRateCents = { ...(where.consultationRateCents || {}), lte: amountToCents(Number(query.priceMax)) };
  }
  if (query.rating) where.ratingAvg = { gte: Number(query.rating) };
  if (query.experience) where.experienceYears = { gte: Number(query.experience) };
  if (query.online === "true") where.availabilityStatus = "online";
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
      include: { category: true, avatarMedia: true },
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
      ...toExpertPublicDto(e, { category: e.category, isSaved: savedIds.has(e.id) }),
      distance: Math.round(nearestDistance(customerLat, customerLng, e.serviceAreas) * 10) / 10,
    }));
    return paginatedResult(items, { page, limit, total });
  }

  // Standard non-geo search with DB-level pagination
  const [experts, total] = await Promise.all([
    db.expertProfile.findMany({ where, skip, take: limit, orderBy, include: { category: true, avatarMedia: true } }),
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
    toExpertPublicDto(e, { category: e.category, isSaved: savedIds.has(e.id) })
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
  const expert = await getDb().expertProfile.findUnique({
    where: { id },
    include: { category: true, avatarMedia: true },
  });
  if (!expert) throw notFound("Expert not found");

  let isSaved;
  if (auth?.customerProfileId) {
    const saved = await getDb().customerSavedExpert.findFirst({
      where: { customerProfileId: auth.customerProfileId, expertProfileId: id },
    });
    isSaved = Boolean(saved);
  }
  return toExpertPublicDto(expert, { category: expert.category, isSaved });
}

export async function getExpertReviews(id, query) {
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
      category: true,
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
  return toExpertMeDto(expert, { user, category: expert.category, subscriptionActive });
}

export async function updateExpertMe(auth, body) {
  const { expert, user, subscriptionActive } = await getExpertProfileOrThrow(auth);
  
  if (body.avatarMediaId) {
    const media = await getDb().mediaAsset.findFirst({
      where: { id: body.avatarMediaId, ownerUserId: auth.userId, status: "ready" }
    });
    if (!media) throw badRequest("Invalid or unready avatar media asset");
  }

  const updated = await getDb().expertProfile.update({
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
      ...(body.availabilityStatus ? { availabilityStatus: body.availabilityStatus } : {}),
      ...(body.categoryId ? { categoryId: body.categoryId } : {}),
      ...(body.avatarMediaId !== undefined ? { avatarMediaId: body.avatarMediaId } : {}),
    },
    include: { category: true, avatarMedia: true, subscriptions: { where: { status: "active" }, take: 1 } },
  });
  return toExpertMeDto(updated, {
    user,
    category: updated.category,
    subscriptionActive,
  });
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
        ...(body.categoryId ? { categoryId: body.categoryId } : {}),
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
  const [pendingQuoteCount, activeConsultationCount, unreadNotificationCount, earnings] =
    await Promise.all([
      db.quoteRequest.count({
        where: { expertId: expert.id, status: { in: ["pending_expert_review", "submitted"] } },
      }),
      db.consultation.count({
        where: { expertId: expert.id, status: { in: ["requested", "ringing", "accepted", "in_progress"] } },
      }),
      db.notification.count({ where: { userId: auth.userId, readAt: null } }),
      db.expertEarningsLedger.aggregate({
        where: {
          expertProfileId: expert.id,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        _sum: { netCents: true },
      }),
    ]);
  return toExpertDashboardDto({
    expert,
    pendingQuoteCount,
    activeConsultationCount,
    unreadNotificationCount,
    earningsThisWeekCents: earnings._sum.netCents ?? 0,
    subscriptionActive,
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
