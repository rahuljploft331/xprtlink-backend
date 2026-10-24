import { getDb } from "@xprtlink/shared/db";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { notFound, badRequest } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";

const fullName = (p) => `${p?.firstName || ""} ${p?.lastName || ""}`.trim() || "Unknown";

const toReportRow = (r, reporter) => ({
  id: r.id,
  reason: r.reason,
  details: r.details,
  status: r.status,
  source: r.source,
  createdAt: r.createdAt,
  reporter: { id: reporter?.id, name: fullName(reporter), email: reporter?.user?.email ?? null },
});

/**
 * One row per reported expert, consolidating every report about them — filed
 * from the expert profile or from chat — with each reporter and reason.
 */
export const listReportedExperts = async (req, res) => {
  const db = getDb();
  const reports = await db.expertReport.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
      expert: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true, status: true } } } },
    },
  });
  return ResponseFormatter.success(res, { data: groupReports(reports, "expert", "customer") });
};

/** Mirror of [listReportedExperts]: customers reported by experts. */
export const listReportedCustomers = async (req, res) => {
  const db = getDb();
  const reports = await db.customerReport.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      expert: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
      customer: { select: { id: true, userId: true, firstName: true, lastName: true, user: { select: { email: true, status: true } } } },
    },
  });
  return ResponseFormatter.success(res, { data: groupReports(reports, "customer", "expert") });
};

function groupReports(reports, targetKey, reporterKey) {
  const map = new Map();
  for (const r of reports) {
    const target = r[targetKey];
    if (!target) continue;
    if (!map.has(target.id)) {
      map.set(target.id, {
        id: target.id,
        // customersApi.suspend takes the user id, expertsApi.suspend the profile id.
        suspendId: targetKey === "customer" ? target.userId : target.id,
        name: fullName(target),
        email: target.user?.email ?? null,
        accountStatus: target.user?.status ?? null,
        role: targetKey,
        count: 0,
        lastReportedAt: r.createdAt,
        reports: [],
      });
    }
    const group = map.get(target.id);
    group.count += 1;
    group.reports.push(toReportRow(r, r[reporterKey]));
  }
  return [...map.values()];
}

export const updateExpertReport = async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { status } = req.body;
  if (!status) throw badRequest("missingRequiredFields");

  const report = await db.expertReport.update({
    where: { id },
    data: { status }
  }).catch(() => null);

  if (!report) throw notFound("resourceNotFound");

  return ResponseFormatter.success(res, { data: report, message: getMessage("updatedSuccessfully") });
};

export const updateCustomerReport = async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { status } = req.body;
  if (!status) throw badRequest("missingRequiredFields");

  const report = await db.customerReport.update({
    where: { id },
    data: { status }
  }).catch(() => null);

  if (!report) throw notFound("resourceNotFound");

  return ResponseFormatter.success(res, { data: report, message: getMessage("updatedSuccessfully") });
};

const bannerMetrics = (sum) => {
  const impressions = sum?.impressions ?? 0;
  // `clicks` is unique clicks (one per viewer per banner); `totalClicks` counts every tap.
  const clicks = sum?.uniqueClicks ?? 0;
  const totalClicks = sum?.clicks ?? 0;
  return { impressions, clicks, totalClicks, ctr: impressions ? Math.round((clicks / impressions) * 1000) / 10 : 0 };
};

const parseDay = (value, fallback) => {
  const d = value ? new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`) : fallback;
  return Number.isNaN(d.getTime()) ? fallback : d;
};

export const getBannerAnalytics = async (req, res) => {
  const db = getDb();
  const today = parseDay(new Date().toISOString().slice(0, 10));
  const to = parseDay(req.query.to, today);
  const from = parseDay(req.query.from, new Date(to.getTime() - 29 * 86400000));
  const dayWhere = { day: { gte: from, lte: to } };

  // Same eligibility as the public banner feed, so "live" means actually being served.
  const liveWhere = {
    isActive: true,
    approvalStatus: "approved",
    expert: {
      verificationStatus: "approved",
      user: { status: "active" },
      subscriptions: { some: { status: "active" } },
    },
  };

  const [liveBanners, pendingBanners, byBanner, byDay] = await Promise.all([
    db.expertBanner.count({ where: liveWhere }),
    db.expertBanner.count({ where: { approvalStatus: "pending" } }),
    db.expertBannerDailyStat.groupBy({
      by: ["bannerId"],
      where: dayWhere,
      _sum: { impressions: true, clicks: true, uniqueClicks: true },
    }),
    db.expertBannerDailyStat.groupBy({
      by: ["day"],
      where: dayWhere,
      _sum: { impressions: true, clicks: true, uniqueClicks: true },
      orderBy: { day: "asc" },
    }),
  ]);

  const ranked = byBanner
    .map((r) => ({ bannerId: r.bannerId, ...bannerMetrics(r._sum) }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  const topIds = ranked.slice(0, 5).map((r) => r.bannerId);
  const topBanners = await db.expertBanner.findMany({
    where: { id: { in: topIds } },
    select: {
      id: true,
      mediaUrl: true,
      text: true,
      isActive: true,
      approvalStatus: true,
      expert: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  const bannerById = new Map(topBanners.map((b) => [b.id, b]));

  const impressions = ranked.reduce((n, r) => n + r.impressions, 0);
  const clicks = ranked.reduce((n, r) => n + r.clicks, 0);
  const totalClicks = ranked.reduce((n, r) => n + r.totalClicks, 0);

  return ResponseFormatter.success(res, {
    data: {
      range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      summary: { liveBanners, pendingBanners, ...bannerMetrics({ impressions, uniqueClicks: clicks, clicks: totalClicks }) },
      topPerforming: ranked
        .slice(0, 5)
        .filter((r) => bannerById.has(r.bannerId))
        .map((r) => ({ ...bannerById.get(r.bannerId), impressions: r.impressions, clicks: r.clicks, totalClicks: r.totalClicks, ctr: r.ctr })),
      daily: byDay.map((d) => ({
        date: d.day.toISOString().slice(0, 10),
        ...bannerMetrics(d._sum),
      })),
    },
  });
};

export const listBanners = async (req, res) => {
  const db = getDb();
  const { status, expertProfileId, isActive } = req.query; // 'pending', 'approved', 'rejected', 'all'
  
  const where = {};
  if (status && status !== "all") {
    where.approvalStatus = status;
  }
  if (expertProfileId) {
    where.expertProfileId = expertProfileId;
  }
  if (typeof isActive !== "undefined" && isActive !== "" && isActive !== null) {
    where.isActive = isActive === "true" || isActive === true;
  }

  const banners = await db.expertBanner.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      expert: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          user: { select: { email: true, status: true } },
          subscriptions: {
            where: { status: "active" },
            include: { plan: { select: { name: true, maxBanners: true, bannerFrequency: true, bannerUploadEnabled: true } } },
            take: 1,
          },
        },
      },
    },
  });

  // Fetch all categories to map targetCategoryId to category name
  const categories = await db.category.findMany({
    select: { id: true, name: true }
  });
  const categoryMap = categories.reduce((acc, cat) => {
    acc[cat.id] = cat.name;
    return acc;
  }, {});

  const totals = await db.expertBannerDailyStat.groupBy({
    by: ["bannerId"],
    where: { bannerId: { in: banners.map((b) => b.id) } },
    _sum: { impressions: true, clicks: true, uniqueClicks: true },
  });
  const totalsMap = new Map(totals.map((t) => [t.bannerId, t._sum]));

  const enrichedBanners = banners.map(banner => ({
    ...banner,
    ...bannerMetrics(totalsMap.get(banner.id)),
    categoryName: banner.targetCategoryId ? categoryMap[banner.targetCategoryId] || 'Unknown Category' : 'All Categories'
  }));

  return ResponseFormatter.success(res, { data: enrichedBanners });
};

export const approveBanner = async (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const banner = await db.expertBanner.update({
    where: { id },
    data: { approvalStatus: "approved", isActive: true },
    include: { expert: { include: { user: true } } }
  }).catch(() => null);

  if (!banner) throw notFound("bannerNotFound");

  if (banner.expert?.user?.email) {
    renderEmailTemplate({
      title: "Your Promotional Banner is Live!",
      bodyHtml: "<p>Great news! Your promotional banner has been approved and is now live on the platform.</p>",
    }).then(html => {
      return sendEmail({ category: "banner",
        to: banner.expert.user.email,
        subject: "Your Banner was Approved",
        text: "Your promotional banner has been approved and is now live.",
        html
      });
    }).catch(e => console.error("[BannerApprove] Email failed:", e));
  }

  return ResponseFormatter.success(res, { data: banner, message: getMessage("updatedSuccessfully") });
};

export const rejectBanner = async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { reason } = req.body;

  if (!reason) throw badRequest("missingRequiredFields");

  const banner = await db.expertBanner.update({
    where: { id },
    data: { approvalStatus: "rejected", isActive: false, rejectionReason: reason },
    include: { expert: { include: { user: true } } }
  }).catch(() => null);

  if (!banner) throw notFound("bannerNotFound");

  if (banner.expert?.user?.email) {
    renderEmailTemplate({
      title: "Banner Submission Update",
      bodyHtml: "<p>We reviewed your recent banner submission, but unfortunately it was not approved.</p><p><strong>Reason:</strong> " + reason + "</p><p>Please review our guidelines and try submitting a new banner.</p>",
      badgeText: "Requires Attention"
    }).then(html => {
      return sendEmail({ category: "banner",
        to: banner.expert.user.email,
        subject: "Your Banner Needs Changes",
        text: "Your banner was rejected for the following reason: " + reason,
        html
      });
    }).catch(e => console.error("[BannerReject] Email failed:", e));
  }

  return ResponseFormatter.success(res, { data: banner, message: getMessage("updatedSuccessfully") });
};

export const toggleBannerActive = async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { isActive } = req.body;

  const existing = await db.expertBanner.findUnique({ where: { id } });
  if (!existing) throw notFound("bannerNotFound");

  const newIsActive = typeof isActive === "boolean" ? isActive : !existing.isActive;

  const banner = await db.expertBanner.update({
    where: { id },
    data: { isActive: newIsActive },
    include: { expert: { include: { user: true } } },
  });

  const msgKey = newIsActive ? "bannerActivated" : "bannerDeactivated";
  return ResponseFormatter.success(res, { data: banner, message: getMessage(msgKey) });
};

export const deleteBanner = async (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const existing = await db.expertBanner.findUnique({ where: { id } });
  if (!existing) throw notFound("bannerNotFound");

  await db.expertBanner.delete({ where: { id } });

  return ResponseFormatter.success(res, { message: getMessage("bannerDeleted") });
};

