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

  const enrichedBanners = banners.map(banner => ({
    ...banner,
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
      ctaText: "View My Banners",
      ctaUrl: "https://xprtlink.com/expert/banners"
    }).then(html => {
      return sendEmail({
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
      return sendEmail({
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

