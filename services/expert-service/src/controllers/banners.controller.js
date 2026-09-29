import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { resolveMediaUrl } from "@xprtlink/shared/mappers/common.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";
import { createBannerSchema } from "@xprtlink/shared/contracts/index.js";

export const getMyBanners = async (auth) => {
  const db = getDb();
  const profile = await db.expertProfile.findUnique({
    where: { userId: auth.userId },
  });
  if (!profile) throw notFound("expertProfileNotFound");

  const banners = await db.expertBanner.findMany({
    where: { expertProfileId: profile.id },
    orderBy: { createdAt: "desc" },
  });

  return banners;
};

export const createBanner = async (auth, inputData) => {
  const parsed = createBannerSchema.safeParse(inputData);
  if (!parsed.success) {
    throw badRequest("validationFailed", "BAD_REQUEST", null, parsed.error.format());
  }
  let { mediaUrl, linkUrl, isActive, targetCategoryId, text } = parsed.data;

  const db = getDb();

  // If mediaUrl is an asset UUID rather than a direct URL, resolve its permanent URL
  if (!mediaUrl.startsWith("http")) {
    const asset = await db.mediaAsset.findUnique({ where: { id: mediaUrl } });
    if (!asset || asset.ownerUserId !== auth.userId) {
      throw badRequest("mediaNotFound", "BAD_REQUEST", null, { mediaUrl });
    }
    mediaUrl = resolveMediaUrl(asset.storageKey);
  }

  const profile = await db.expertProfile.findUnique({
    where: { userId: auth.userId },
    include: {
      user: true,
      subscriptions: {
        where: { status: "active" },
        include: { plan: true },
        take: 1,
      },
    },
  });

  if (!profile) throw notFound("expertProfileNotFound");

  const activeSubscription = profile.subscriptions[0];
  const maxBanners = activeSubscription?.plan?.maxBanners || 0;

  if (maxBanners === 0) {
    throw badRequest("planDoesNotSupportBanners");
  }

  const currentBannersCount = await db.expertBanner.count({
    where: { expertProfileId: profile.id },
  });

  if (currentBannersCount >= maxBanners) {
    throw badRequest("bannerLimitReached", "BAD_REQUEST", null, { maxBanners });
  }

  const banner = await db.expertBanner.create({
    data: {
      expertProfileId: profile.id,
      mediaUrl,
      linkUrl,
      text,
      targetCategoryId,
      isActive,
    },
  });

  // Send an email notification to the expert confirming upload
  if (profile.user?.email) {
    renderEmailTemplate({
      title: "Banner Upload Received",
      bodyHtml: "<p>We have successfully received your new promotional banner. It is currently in a <strong>pending</strong> state while our moderation team reviews it.</p><p>We will send you another update once it has been approved or if changes are required.</p>",
      badgeText: "Under Review"
    }).then(html => {
      sendEmail({
        to: profile.user.email,
        subject: "Your Banner is Under Review",
        text: "Your new promotional banner has been received and is currently pending review.",
        html
      });
    }).catch(e => console.error("[BannerUpload] Email failed:", e));
  }

  // Optional: You could also trigger an email to an admin address here to notify them of a pending banner.

  return banner;
};

export const deleteBanner = async (auth, bannerId) => {
  const db = getDb();
  
  const profile = await db.expertProfile.findUnique({
    where: { userId: auth.userId },
  });
  if (!profile) throw notFound("expertProfileNotFound");

  const banner = await db.expertBanner.findFirst({
    where: { id: bannerId, expertProfileId: profile.id },
  });
  if (!banner) throw notFound("bannerNotFound");

  await db.expertBanner.delete({ where: { id: bannerId } });
  
  return { success: true };
};

export const getPublicBanners = async (categoryId, query = {}) => {
  const db = getDb();
  const { limit, skip } = parsePagination(query, { defaultLimit: 20 });
  
  // We want to fetch active banners from experts who have an active subscription
  // and order them by the highest tier plan first (e.g. priceMonthlyCents desc)
  
  const banners = await db.expertBanner.findMany({
    where: {
      isActive: true,
      approvalStatus: "approved",
      ...(categoryId ? { targetCategoryId: categoryId } : {}),
      expert: {
        verificationStatus: "approved",
        user: { status: "active" },
        subscriptions: {
          some: { status: "active" }
        }
      }
    },
    include: {
      expert: {
        include: {
          avatarMedia: true,
          categories: { select: { name: true, slug: true } },
          subscriptions: {
            where: { status: "active" },
            include: { plan: true },
            take: 1
          }
        }
      }
    },
    take: limit,
    skip: skip,
  });

  // Since Prisma doesn't easily let us order by a relation's relation field (subscription plan price),
  // we can sort them in memory since the banner count won't be extremely huge in a single query,
  // or we can sort by the active subscription's price.
  
  // Randomly shuffle the array first to ensure fair rotation
  for (let i = banners.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [banners[i], banners[j]] = [banners[j], banners[i]];
  }

  // Then sort by subscription tier (stable sort based on random order)
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
    text: b.text,
    targetCategoryId: b.targetCategoryId,
    expert: {
      id: b.expert.id,
      firstName: b.expert.firstName,
      lastName: b.expert.lastName,
      avatarUrl: resolveMediaUrl(b.expert.avatarMedia?.storageKey),
      category: b.expert.categories?.[0]?.name,
      categorySlug: b.expert.categories?.[0]?.slug,
      plan: b.expert.subscriptions[0]?.plan?.name || "Core",
    }
  }));
};
