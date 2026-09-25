import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { logAdminAction } from "#utils/audit.js";
import { resolveMediaUrl } from "@xprtlink/shared/mappers/common.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";
const log = logger.child({ module: "verifications.controller" });


/** GET /api/v1/admin/verifications */
export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const status = req.query.status;
    const where = status ? { status } : {};

    const [total, verifications] = await Promise.all([
      db.expertVerification.count({ where }),
      db.expertVerification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { submittedAt: "desc" },
        include: {
          expert: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { documents: true } },
        },
      }),
    ]);

    const items = verifications.map((v) => ({
      id: v.id,
      expert: v.expert,
      status: v.status,
      submittedAt: v.submittedAt,
      reviewedAt: v.reviewedAt,
      reviewNotes: v.reviewNotes,
      documentCount: v._count.documents,
    }));

    return ResponseFormatter.paginated(res, { items, page, limit, total });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/admin/verifications/:id */
export async function getById(req, res, next) {
  try {
    const db = getDb();
    const v = await db.expertVerification.findUnique({
      where: { id: req.params.id },
      include: {
        expert: { include: { user: { select: { email: true } } } },
        documents: { include: { media: true } },
      },
    });
    if (!v) {
      return res.status(404).json({ success: false, message: getMessage("verificationNotFound"), code: "NOT_FOUND" });
    }

    // Attach a resolved public URL to each document's media so the admin
    // frontend can display it without needing a separate signed-URL call.
    const payload = {
      ...v,
      documents: v.documents.map((doc) => ({
        ...doc,
        media: doc.media
          ? { ...doc.media, url: resolveMediaUrl(doc.media.storageKey) }
          : null,
      })),
    };

    return ResponseFormatter.success(res, { data: payload });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/admin/verifications/:id/approve */
export async function approve(req, res, next) {
  try {
    const db = getDb();

    const result = await db.$transaction(async (tx) => {
      // 1. Update verification record
      const v = await tx.expertVerification.update({
        where: { id: req.params.id },
        data: {
          status: "approved",
          reviewedAt: new Date(),
          reviewNotes: req.body?.notes ?? null,
        },
      });

      // 2. Check if expert has an active subscription
      const activeSubscription = await tx.expertSubscription.findFirst({
        where: {
          expertProfileId: v.expertProfileId,
          status: "active",
        },
      });

      // 3. Update expert profile: always set verificationStatus,
      //    conditionally set searchEligible based on subscription
      await tx.expertProfile.update({
        where: { id: v.expertProfileId },
        data: {
          verificationStatus: "approved",
          searchEligible: !!activeSubscription,
        },
      });

      return v;
    });

    await logAdminAction(req, "verification.approve", "ExpertVerification", result.id, {
      notes: req.body?.notes ?? null,
    });

    // Notify the expert that their profile was approved (non-fatal)
    try {
      const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
      const expertProfile = await db.expertProfile.findUnique({
        where: { id: result.expertProfileId },
        select: { userId: true, firstName: true },
      });
      if (expertProfile?.userId) {
        await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
          userIds: [expertProfile.userId],
          type: "verification_approved",
          title: "Profile Approved ✓",
          body: `Congratulations${expertProfile.firstName ? `, ${expertProfile.firstName}` : ""}! Your expert profile has been approved. You can now receive consultation requests.`,
          data: { verificationId: result.id },
        });
      }
    } catch (err) {
      log.error(`[verifications.approve] Notification dispatch failed: ${err.message}`);
    }

    return ResponseFormatter.success(res, { message: getMessage("verificationApproved"), data: result });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/admin/verifications/:id/reject */
export async function reject(req, res, next) {
  try {
    const db = getDb();
    const rejectionNotes = req.body?.notes ?? "Rejected by admin";

    const v = await db.expertVerification.update({
      where: { id: req.params.id },
      data: {
        status: "rejected",
        reviewedAt: new Date(),
        reviewNotes: rejectionNotes,
      },
    });
    await db.expertProfile.update({
      where: { id: v.expertProfileId },
      data: { verificationStatus: "rejected" },
    });
    await logAdminAction(req, "verification.reject", "ExpertVerification", v.id, {
      notes: rejectionNotes,
    });

    // Fetch expert profile + user email for notifications (non-fatal block)
    let expertProfile = null;
    let expertEmail = null;
    try {
      expertProfile = await db.expertProfile.findUnique({
        where: { id: v.expertProfileId },
        select: {
          userId: true,
          firstName: true,
          user: { select: { email: true } },
        },
      });
      expertEmail = expertProfile?.user?.email ?? null;
    } catch (err) {
      log.error(`[verifications.reject] Failed to fetch expert profile for notifications: ${err.message}`);
    }

    // Push notification (non-fatal)
    try {
      const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
      if (expertProfile?.userId) {
        await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
          userIds: [expertProfile.userId],
          type: "verification_rejected",
          title: "Verification Update",
          body: `Your expert profile verification was not approved. Please review the admin notes and resubmit your documents.`,
          data: { verificationId: v.id, notes: rejectionNotes },
        });
      }
    } catch (err) {
      log.error(`[verifications.reject] Notification dispatch failed: ${err.message}`);
    }

    // Email notification with rejection reason (non-fatal)
    try {
      if (expertEmail) {
        const firstName = expertProfile?.firstName ?? "Expert";
        const reasonHtml = `<p style="margin:0 0 12px">${rejectionNotes.replace(/\n/g, "<br>")}</p>`;
        const bodyHtml = `
          <p style="margin:0 0 12px">Hi ${firstName},</p>
          <p style="margin:0 0 12px">Thank you for submitting your verification documents on XprtLink. Unfortunately, we were unable to verify your identity at this time.</p>
          <p style="margin:0 0 6px"><strong>Reason provided by the reviewer:</strong></p>
          <div style="background:#fff1f2;border-left:4px solid #e11d48;padding:12px 16px;border-radius:4px;margin:0 0 16px">${reasonHtml}</div>
          <p style="margin:0 0 12px">Please re-open the XprtLink app, upload fresh, high-quality copies of your government-issued ID, and resubmit for review. Our team will process your new submission promptly.</p>
          <p style="margin:0">If you believe this decision was made in error, please contact our support team.</p>
        `;
        const html = await renderEmailTemplate({
          title: "Verification Not Approved",
          bodyHtml,
          badgeText: "Action Required",
          ctaText: "Re-upload Documents",
          ctaUrl: process.env.APP_DEEP_LINK_URL ?? "https://xprtlink.com",
        });
        await sendEmail({
          to: expertEmail,
          subject: getMessage("verificationRejectedEmailSubject"),
          text: `Hi ${firstName},\n\nYour XprtLink verification was not approved.\n\nReason: ${rejectionNotes}\n\nPlease re-open the app and re-upload your documents.`,
          html,
        });
      }
    } catch (err) {
      log.error(`[verifications.reject] Email dispatch failed: ${err.message}`);
    }

    return ResponseFormatter.success(res, { message: getMessage("verificationRejected"), data: v });
  } catch (err) {
    next(err);
  }
}
