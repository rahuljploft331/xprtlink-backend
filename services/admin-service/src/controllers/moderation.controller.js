import { getDb } from "@xprtlink/shared/db";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { notFound, badRequest } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";

export const listExpertReports = async (req, res) => {
  const db = getDb();
  const reports = await db.expertReport.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true } },
      expert: { select: { id: true, firstName: true, lastName: true } }
    }
  });
  return ResponseFormatter.success(res, { data: reports });
};

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

export const listConversationReports = async (req, res) => {
  const db = getDb();
  const reports = await db.conversationReport.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      reporter: {
        select: {
          id: true,
          email: true,
          customerProfile: { select: { id: true, firstName: true, lastName: true } },
          expertProfile: { select: { id: true, firstName: true, lastName: true } },
        }
      },
      conversation: { 
        select: { 
          id: true, 
          customerId: true, 
          expertId: true,
          customer: { select: { userId: true, firstName: true, lastName: true, user: { select: { email: true } } } },
          expert: { select: { userId: true, firstName: true, lastName: true, user: { select: { email: true } } } }
        } 
      }
    }
  });

  const formattedReports = reports.map((r) => {
    let reportedUser = null;
    if (r.reporter) {
      if (r.reporter.expertProfile && r.conversation.customer) {
        reportedUser = {
          userId: r.conversation.customer.userId,
          profileId: r.conversation.customerId,
          email: r.conversation.customer.user?.email || "Unknown",
          name: `${r.conversation.customer.firstName} ${r.conversation.customer.lastName}`,
          role: "customer"
        };
      } else if (r.reporter.customerProfile && r.conversation.expert) {
        reportedUser = {
          userId: r.conversation.expert.userId,
          profileId: r.conversation.expertId,
          email: r.conversation.expert.user?.email || "Unknown",
          name: `${r.conversation.expert.firstName} ${r.conversation.expert.lastName}`,
          role: "expert"
        };
      }
    }

    return {
      ...r,
      reporter: r.reporter ? {
        id: r.reporter.id,
        email: r.reporter.email,
        role: r.reporter.expertProfile ? "expert" : r.reporter.customerProfile ? "customer" : "unknown",
      } : null,
      reportedUser
    };
  });

  return ResponseFormatter.success(res, { data: formattedReports });
};

export const deleteConversationReport = async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  
  const report = await db.conversationReport.delete({
    where: { id }
  }).catch(() => null);

  if (!report) throw notFound("resourceNotFound");

  return ResponseFormatter.success(res, { message: getMessage("deletedSuccessfully") });
};

export const listBanners = async (req, res) => {
  const db = getDb();
  const { status } = req.query; // 'pending', 'approved', 'rejected'
  
  const banners = await db.expertBanner.findMany({
    where: status ? { approvalStatus: status } : {},
    orderBy: { createdAt: "desc" },
    include: {
      expert: {
        select: { id: true, firstName: true, lastName: true }
      }
    }
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
    categoryName: banner.targetCategoryId ? categoryMap[banner.targetCategoryId] || 'Unknown Category' : 'No tag'
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
