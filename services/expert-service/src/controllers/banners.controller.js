import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";

export const getMyBanners = async (auth) => {
  const db = getDb();
  const profile = await db.expertProfile.findUnique({
    where: { userId: auth.userId },
  });
  if (!profile) throw notFound("Expert profile not found");

  const banners = await db.expertBanner.findMany({
    where: { expertProfileId: profile.id },
    orderBy: { createdAt: "desc" },
  });

  return banners;
};

export const createBanner = async (auth, { mediaUrl, linkUrl, isActive = true }) => {
  const db = getDb();

  const profile = await db.expertProfile.findUnique({
    where: { userId: auth.userId },
    include: {
      subscriptions: {
        where: { status: "active" },
        include: { plan: true },
        take: 1,
      },
    },
  });

  if (!profile) throw notFound("Expert profile not found");

  const activeSubscription = profile.subscriptions[0];
  const maxBanners = activeSubscription?.plan?.maxBanners || 0;

  if (maxBanners === 0) {
    throw badRequest("Your current subscription plan does not support banners.");
  }

  const currentBannersCount = await db.expertBanner.count({
    where: { expertProfileId: profile.id },
  });

  if (currentBannersCount >= maxBanners) {
    throw badRequest(`You have reached the maximum limit of ${maxBanners} banners for your plan.`);
  }

  const banner = await db.expertBanner.create({
    data: {
      expertProfileId: profile.id,
      mediaUrl,
      linkUrl,
      isActive,
    },
  });

  return banner;
};

export const deleteBanner = async (auth, bannerId) => {
  const db = getDb();
  
  const profile = await db.expertProfile.findUnique({
    where: { userId: auth.userId },
  });
  if (!profile) throw notFound("Expert profile not found");

  const banner = await db.expertBanner.findFirst({
    where: { id: bannerId, expertProfileId: profile.id },
  });
  if (!banner) throw notFound("Banner not found or you don't have permission to delete it.");

  await db.expertBanner.delete({ where: { id: bannerId } });
  
  return { success: true };
};

export const getPublicBanners = async () => {
  const db = getDb();
  
  // We want to fetch active banners from experts who have an active subscription
  // and order them by the highest tier plan first (e.g. priceMonthlyCents desc)
  
  const banners = await db.expertBanner.findMany({
    where: {
      isActive: true,
      expert: {
        subscriptions: {
          some: { status: "active" }
        }
      }
    },
    include: {
      expert: {
        include: {
          user: { select: { firstName: true, lastName: true, avatarUrl: true } },
          category: { select: { name: true, slug: true } },
          subscriptions: {
            where: { status: "active" },
            include: { plan: true },
            take: 1
          }
        }
      }
    }
  });

  // Since Prisma doesn't easily let us order by a relation's relation field (subscription plan price),
  // we can sort them in memory since the banner count won't be extremely huge in a single query,
  // or we can sort by the active subscription's price.
  
  const sortedBanners = banners.sort((a, b) => {
    const priceA = a.expert.subscriptions[0]?.plan?.priceMonthlyCents || 0;
    const priceB = b.expert.subscriptions[0]?.plan?.priceMonthlyCents || 0;
    return priceB - priceA; // Descending (highest tier first)
  });

  // Map to a clean public format
  return sortedBanners.map(b => ({
    id: b.id,
    mediaUrl: b.mediaUrl,
    linkUrl: b.linkUrl,
    expert: {
      id: b.expert.id,
      firstName: b.expert.user.firstName,
      lastName: b.expert.user.lastName,
      avatarUrl: b.expert.user.avatarUrl,
      category: b.expert.category.name,
      categorySlug: b.expert.category.slug,
      plan: b.expert.subscriptions[0]?.plan?.name || "Core",
    }
  }));
};
