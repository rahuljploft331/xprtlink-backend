import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { resolveMediaUrl } from "@xprtlink/shared/mappers/common.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logAdminAction } from "#utils/audit.js";
import { adminSetFeaturedSchema } from "@xprtlink/shared/contracts/expert.schema.js";
import { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "experts.controller" });

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** GET /api/v1/admin/experts */
export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const q = req.query.q?.trim();
    const status = req.query.status;
    const poorReviewsAlert = req.query.poorReviewsAlert;

    const where = {};
    if (status) where.verificationStatus = status;
    if (poorReviewsAlert === "Yes" || poorReviewsAlert === "true") where.poorReviewsAlert = true;
    else if (poorReviewsAlert === "No" || poorReviewsAlert === "false") where.poorReviewsAlert = false;
    
    if (q) {
      where.OR = [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ];
    }

    const sortField = req.query.sort || "createdAt";
    const sortOrder = req.query.order === "asc" ? "asc" : "desc";
    let orderBy = { createdAt: sortOrder };

    if (sortField === "name") {
      orderBy = { firstName: sortOrder };
    } else if (sortField === "status") {
      orderBy = { verificationStatus: sortOrder };
    } else if (sortField === "rating") {
      orderBy = { ratingAvg: sortOrder };
    }

    const [total, experts] = await Promise.all([
      db.expertProfile.count({ where }),
      db.expertProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          avatarMedia: true,
          categories: { select: { id: true, name: true, slug: true } },
          subscriptions: {
            where: { status: "active" },
            take: 1,
            include: { plan: { select: { name: true, code: true } } },
          },
          user: { select: { status: true } },
        },
      }),
    ]);

    const items = experts.map((e) => ({
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      avatarUrl: resolveMediaUrl(e.avatarMedia?.storageKey),
      categories: e.categories,
      verificationStatus: e.verificationStatus,
      accountStatus: e.user?.status,
      availabilityStatus: e.availabilityStatus,
      ratingAvg: e.ratingAvg,
      ratingCount: e.ratingCount,
      poorReviewsAlert: e.poorReviewsAlert,
      activeSubscription: e.subscriptions[0] ?? null,
      isFeatured: e.isFeatured,
      featuredRank: e.featuredRank,
      featuredUntil: e.featuredUntil,
      createdAt: e.createdAt,
    }));

    return ResponseFormatter.paginated(res, { items, page, limit, total });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/admin/experts/:id */
export async function getById(req, res, next) {
  try {
    if (!uuidRegex.test(req.params.id)) {
      return res.status(404).json({ success: false, message: getMessage("expertNotFound"), code: "NOT_FOUND" });
    }
    const db = getDb();
    const expert = await db.expertProfile.findUnique({
      where: { id: req.params.id },
      include: {
        avatarMedia: true,
        categories: true,
        verifications: { include: { documents: true }, orderBy: { createdAt: "desc" }, take: 5 },
        subscriptions: { include: { plan: true }, orderBy: { createdAt: "desc" }, take: 1 },
        reviews: { take: 10, orderBy: { createdAt: "desc" } },
        payouts: { take: 5, orderBy: { createdAt: "desc" } },
        user: { select: { email: true, phone: true, status: true, createdAt: true } },
      },
    });
    if (!expert) {
      return res.status(404).json({ success: false, message: getMessage("expertNotFound"), code: "NOT_FOUND" });
    }
    if (expert) {
      expert.avatarUrl = resolveMediaUrl(expert.avatarMedia?.storageKey);
    }
    return ResponseFormatter.success(res, { data: expert });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/admin/experts/:id/featured */
export async function setFeatured(req, res, next) {
  try {
    if (!uuidRegex.test(req.params.id)) {
      return res.status(404).json({ success: false, message: getMessage("expertNotFound"), code: "NOT_FOUND" });
    }
    const db = getDb();
    const { isFeatured, featuredRank, featuredUntil } = adminSetFeaturedSchema.parse(req.body);

    const existing = await db.expertProfile.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: getMessage("expertNotFound"), code: "NOT_FOUND" });
    }

    const expert = await db.expertProfile.update({
      where: { id: req.params.id },
      data: {
        isFeatured,
        // Clear ordering/expiry when un-featuring so stale values can't leak back in.
        featuredRank: isFeatured ? (featuredRank ?? null) : null,
        featuredUntil: isFeatured ? (featuredUntil ? new Date(featuredUntil) : null) : null,
      },
    });

    await logAdminAction(req, "expert.setFeatured", "ExpertProfile", expert.id, {
      isFeatured,
      featuredRank: expert.featuredRank,
      featuredUntil: expert.featuredUntil,
    });

    return ResponseFormatter.success(res, {
      message: getMessage("expertFeaturedUpdated"),
      data: {
        id: expert.id,
        isFeatured: expert.isFeatured,
        featuredRank: expert.featuredRank,
        featuredUntil: expert.featuredUntil,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const db = getDb();
    const { 
      email, phone, status, 
      firstName, lastName, headline, bio, title, businessName, 
      consultationRateCents, currency, experienceYears, searchEligible
    } = req.body;
    
    const userData = {};
    if (email !== undefined) userData.email = email;
    if (phone !== undefined) userData.phone = phone;
    if (status !== undefined) {
      userData.status = status;
      if (status === "deleted") {
        userData.deletedAt = new Date();
        userData.firebaseUid = null;
      }
    }
    
    const profileData = {};
    if (firstName !== undefined) profileData.firstName = firstName;
    if (lastName !== undefined) profileData.lastName = lastName;
    if (headline !== undefined) profileData.headline = headline;
    if (bio !== undefined) profileData.bio = bio;
    if (title !== undefined) profileData.title = title;
    if (businessName !== undefined) profileData.businessName = businessName;
    if (consultationRateCents !== undefined) profileData.consultationRateCents = consultationRateCents;
    if (currency !== undefined) profileData.currency = currency;
    if (experienceYears !== undefined) {
      const parsedExperience = parseInt(experienceYears, 10);
      if (isNaN(parsedExperience) || parsedExperience < 0 || parsedExperience > 99) {
        return res.status(400).json({ success: false, message: getMessage("invalidQueryParameters"), code: "VALIDATION_ERROR" });
      }
      profileData.experienceYears = parsedExperience;
    }
    if (searchEligible !== undefined) profileData.searchEligible = searchEligible;

    const expertProfile = await db.expertProfile.findUnique({ where: { id: req.params.id } });
    if (!expertProfile) {
      return res.status(404).json({ success: false, message: getMessage("expertNotFound"), code: "NOT_FOUND" });
    }

    const expert = await db.user.update({
      where: { id: expertProfile.userId },
      data: {
        ...userData,
        ...(Object.keys(profileData).length > 0 && {
          expertProfile: {
            update: profileData
          }
        })
      },
      include: {
        expertProfile: true
      }
    });

    return ResponseFormatter.success(res, { data: expert });
  } catch (err) {
    next(err);
  }
}

export async function setStatus(req, res, next) {
  try {
    const db = getDb();
    const expertProfile = await db.expertProfile.findUnique({ where: { id: req.params.id } });
    if (!expertProfile) {
      return res.status(404).json({ success: false, message: getMessage("expertNotFound"), code: "NOT_FOUND" });
    }

    const status = req.path.endsWith("suspend") ? "suspended" : "active";
    const expert = await db.user.update({
      where: { id: expertProfile.userId },
      data: { status },
    });

    if (status === "suspended") {
      const { revokeAllUserSessions } = await import("@xprtlink/shared/auth/tokens.js");
      await revokeAllUserSessions(expertProfile.userId);

      try {
        const { getConfig } = await import("@xprtlink/shared/config/loadEnv.js");
        const { internalPost } = await import("@xprtlink/shared/lib/internalFetch.js");
        const messagingUrl = getConfig("admin-service").serviceUrls.messaging;
        await internalPost(messagingUrl, "/api/internal/events/account-disabled", { userId: expertProfile.userId });
      } catch (err) {
        log.error({ err: err }, "Failed to notify messaging service about disabled account");
      }
    }

    return ResponseFormatter.success(res, { data: expert });
  } catch (err) {
    next(err);
  }
}

export async function getTransactions(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    
    const expertProfile = await db.expertProfile.findUnique({ where: { id: req.params.id } });
    if (!expertProfile) {
      return res.status(404).json({ success: false, message: getMessage("expertNotFound"), code: "NOT_FOUND" });
    }

    const expertProfileId = expertProfile.id;

    const [total, items] = await Promise.all([
      db.transaction.count({
        where: {
          OR: [
            { consultationCharge: { consultation: { expertId: expertProfileId } } },
          ]
        }
      }),
      db.transaction.findMany({
        where: {
          OR: [
            { consultationCharge: { consultation: { expertId: expertProfileId } } },
          ]
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          consultationCharge: {
            include: { consultation: { include: { customer: true } } }
          }
        }
      })
    ]);

    const formattedItems = items.map(t => ({
      id: t.id,
      type: t.type,
      amountCents: t.amountCents,
      currency: t.currency,
      status: t.status,
      customerName: t.consultationCharge ? `${t.consultationCharge.consultation.customer.firstName} ${t.consultationCharge.consultation.customer.lastName}` : null,
      createdAt: t.createdAt,
    }));

    return ResponseFormatter.paginated(res, { items: formattedItems, page, limit, total });
  } catch (err) {
    next(err);
  }
}

export async function getSupportChats(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);

    const expertProfile = await db.expertProfile.findUnique({ where: { id: req.params.id } });
    if (!expertProfile) {
      return res.status(404).json({ success: false, message: getMessage("expertNotFound"), code: "NOT_FOUND" });
    }

    const [total, items] = await Promise.all([
      db.supportConversation.count({
        where: { userId: expertProfile.userId }
      }),
      db.supportConversation.findMany({
        where: { userId: expertProfile.userId },
        skip,
        take: limit,
        orderBy: { lastMessageAt: "desc" },
        include: {
          admin: { select: { name: true } },
          _count: { select: { messages: true } }
        }
      })
    ]);

    const formattedItems = items.map(c => ({
      id: c.id,
      status: c.status,
      assignedAdmin: c.admin?.name ?? "Unassigned",
      messageCount: c._count.messages,
      lastMessageAt: c.lastMessageAt,
      createdAt: c.createdAt,
    }));

    return ResponseFormatter.paginated(res, { items: formattedItems, page, limit, total });
  } catch (err) {
    next(err);
  }
}

export async function sendEmailToExpert(req, res, next) {
  try {
    const db = getDb();
    const { subject, bodyHtml } = req.body;

    const expertProfile = await db.expertProfile.findUnique({
      where: { id: req.params.id },
      include: { user: true }
    });

    if (!expertProfile) {
      return res.status(404).json({ success: false, message: getMessage("expertNotFound"), code: "NOT_FOUND" });
    }

    if (!expertProfile.user || !expertProfile.user.email) {
      return res.status(400).json({ success: false, message: getMessage("expertNoEmail"), code: "BAD_REQUEST" });
    }

    const html = await renderEmailTemplate({
      title: subject,
      bodyHtml,
    });

    await sendEmail({
      to: expertProfile.user.email,
      subject,
      html,
    });

    await logAdminAction(req, "expert.sendEmail", "ExpertProfile", expertProfile.id, {
      subject,
    });

    return ResponseFormatter.success(res, { message: getMessage("emailSentSuccessfully") });
  } catch (err) {
    next(err);
  }
}
