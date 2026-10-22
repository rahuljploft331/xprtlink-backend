import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { resolveMediaUrl } from "@xprtlink/shared/mappers/common.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logAdminAction } from "#utils/audit.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "customers.controller" });


/** GET /api/v1/admin/customers */
export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const q = req.query.q?.trim();
    const status = req.query.status;

    const where = {};
    if (status) {
      where.status = status;
    }
    if (q) {
      where.OR = [
        { email: { contains: q, mode: "insensitive" } },
        { customerProfile: { firstName: { contains: q, mode: "insensitive" } } },
        { customerProfile: { lastName: { contains: q, mode: "insensitive" } } },
      ];
    }

    const sortField = req.query.sort || "createdAt";
    const sortOrder = req.query.order === "asc" ? "asc" : "desc";
    let orderBy = { createdAt: sortOrder };

    if (sortField === "email" || sortField === "status") {
      orderBy = { [sortField]: sortOrder };
    } else if (sortField === "name") {
      orderBy = { customerProfile: { firstName: sortOrder } };
    }

    const [total, users] = await Promise.all([
      db.user.count({ where: { customerProfile: { isNot: null }, ...where } }),
      db.user.findMany({
        where: { customerProfile: { isNot: null }, ...where },
        skip,
        take: limit,
        orderBy,
        include: {
          customerProfile: {
            include: { avatarMedia: true },
          },
          _count: { select: { authSessions: true } },
        },
      }),
    ]);

    // Get consultation counts per customer profile
    const customerIds = users.map((u) => u.customerProfile?.id).filter(Boolean);
    const consultationCounts = await db.consultation.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds } },
      _count: { id: true },
    });
    const countMap = Object.fromEntries(
      consultationCounts.map((c) => [c.customerId, c._count.id])
    );

    const items = users.map((u) => ({
      id: u.id,
      email: u.email,
      phone: u.phone,
      status: u.status,
      firstName: u.customerProfile?.firstName ?? "",
      lastName: u.customerProfile?.lastName ?? "",
      avatarUrl: resolveMediaUrl(u.customerProfile?.avatarMedia?.storageKey),
      consultationCount: countMap[u.customerProfile?.id] ?? 0,
      createdAt: u.createdAt,
      lastActiveAt: u.customerProfile?.updatedAt ?? u.createdAt,
    }));

    return ResponseFormatter.paginated(res, { items, page, limit, total });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/admin/customers/:id */
export async function getById(req, res, next) {
  try {
    const db = getDb();
    const user = await db.user.findUnique({
      where: { id: req.params.id },
      include: {
        customerProfile: {
          include: {
            avatarMedia: true,
            consultations: {
              take: 10,
              orderBy: { createdAt: "desc" },
              include: { expert: { select: { firstName: true, lastName: true } } },
            },
            expertReports: {
              take: 10,
              orderBy: { createdAt: "desc" },
              include: { expert: { select: { firstName: true, lastName: true } } }
            }
          },
        },
      },
    });
    if (!user || !user.customerProfile) {
      return res.status(404).json({ success: false, message: getMessage("customerNotFound"), code: "NOT_FOUND" });
    }
    const { passwordHash: _ph, ...safe } = user;
    if (safe.customerProfile) {
      safe.customerProfile.avatarUrl = resolveMediaUrl(safe.customerProfile.avatarMedia?.storageKey);
    }
    return ResponseFormatter.success(res, { data: safe });
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const db = getDb();
    const { email, phone, status, firstName, lastName } = req.body;
    
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

    const customer = await db.user.update({
      where: { id: req.params.id },
      data: {
        ...userData,
        ...(Object.keys(profileData).length > 0 && {
          customerProfile: {
            update: profileData
          }
        })
      },
      include: {
        customerProfile: true
      }
    });

    return ResponseFormatter.success(res, { data: customer });
  } catch (err) {
    next(err);
  }
}

export async function setStatus(req, res, next) {
  try {
    const db = getDb();
    const status = req.path.endsWith("suspend") ? "suspended" : "active";
    const customer = await db.user.update({
      where: { id: req.params.id },
      data: { status },
    });
    
    if (status === "suspended") {
      const { revokeAllUserSessions } = await import("@xprtlink/shared/auth/tokens.js");
      await revokeAllUserSessions(customer.id);
      
      try {
        const { getConfig } = await import("@xprtlink/shared/config/loadEnv.js");
        const { internalPost } = await import("@xprtlink/shared/lib/internalFetch.js");
        const messagingUrl = getConfig("admin-service").serviceUrls.messaging;
        await internalPost(messagingUrl, "/api/internal/events/account-disabled", { userId: customer.id });
      } catch (err) {
        log.error({ err: err }, "Failed to notify messaging service about disabled account");
      }
    }
    
    return ResponseFormatter.success(res, { data: customer });
  } catch (err) {
    next(err);
  }
}

export async function getTransactions(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    
    const user = await db.user.findUnique({
      where: { id: req.params.id },
      include: {
        customerProfile: {
          include: {
            paymentMethods: {
              orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
              take: 1,
              select: { brand: true, last4: true },
            },
          },
        },
      },
    });
    if (!user || !user.customerProfile) {
      return res.status(404).json({ success: false, message: getMessage("customerNotFound"), code: "NOT_FOUND" });
    }

    const [total, items] = await Promise.all([
      db.transaction.count({
        where: {
          consultationCharge: {
            consultation: { customerId: user.customerProfile.id }
          }
        }
      }),
      db.transaction.findMany({
        where: {
          consultationCharge: {
            consultation: { customerId: user.customerProfile.id }
          }
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          consultationCharge: {
            include: { consultation: { include: { expert: true } } }
          }
        }
      })
    ]);

    const defaultPm = user.customerProfile.paymentMethods?.[0] || null;
    const formattedItems = items.map(t => {
      const brand = t.metadata?.brand || defaultPm?.brand;
      const last4 = t.metadata?.last4 || defaultPm?.last4;
      const brandLabel = brand ? brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase() : null;
      const method = t.metadata?.paymentMethod || (brandLabel && last4 ? `${brandLabel} •••• ${last4}` : "Card");
      return {
        id: t.id,
        type: t.type,
        amountCents: t.amountCents,
        currency: t.currency,
        status: t.status,
        method,
        expertName: t.consultationCharge ? `${t.consultationCharge.consultation.expert.firstName} ${t.consultationCharge.consultation.expert.lastName}` : null,
        createdAt: t.createdAt,
      };
    });

    return ResponseFormatter.paginated(res, { items: formattedItems, page, limit, total });
  } catch (err) {
    next(err);
  }
}

export async function getSupportChats(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);

    const [total, items] = await Promise.all([
      db.supportConversation.count({
        where: { userId: req.params.id }
      }),
      db.supportConversation.findMany({
        where: { userId: req.params.id },
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

/** DELETE /api/v1/admin/customers/:id */
export async function remove(req, res, next) {
  try {
    const db = getDb();
    let user = await db.user.findUnique({
      where: { id: req.params.id },
      include: { customerProfile: true, expertProfile: true },
    });

    if (!user && req.params.id) {
      const profile = await db.customerProfile.findUnique({
        where: { id: req.params.id },
        include: { user: { include: { customerProfile: true, expertProfile: true } } },
      });
      if (profile) user = profile.user;
    }

    if (!user || !user.customerProfile) {
      return res.status(404).json({
        success: false,
        message: getMessage("customerNotFound"),
        code: "NOT_FOUND",
      });
    }

    if (user.status === "deleted") {
      return res.status(400).json({
        success: false,
        message: getMessage("cannotDeleteAlreadyDeleted"),
        code: "BAD_REQUEST",
      });
    }

    await db.$transaction(async (tx) => {
      // 1. Soft delete the user row, freeing up email/phone partial unique indexes
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: "deleted",
          deletedAt: new Date(),
          firebaseUid: null,
        },
      });

      // 2. Revoke all active sessions and refresh tokens
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // 3. Remove push notification device tokens
      await tx.deviceToken.deleteMany({
        where: { userId: user.id },
      });

      // 4. If expert profile also exists, disable discovery & cancel active subscriptions
      if (user.expertProfile) {
        await tx.expertProfile.update({
          where: { id: user.expertProfile.id },
          data: {
            availabilityStatus: "offline",
            searchEligible: false,
            isFeatured: false,
            featuredRank: null,
            featuredUntil: null,
          },
        });

        await tx.expertSubscription.updateMany({
          where: { expertProfileId: user.expertProfile.id, status: "active" },
          data: { status: "canceled", canceledAt: new Date() },
        });
      }
    });

    // Invalidate in-memory userStatusCache
    try {
      const { invalidateUserStatusCache } = await import("@xprtlink/shared/middleware/auth.js");
      invalidateUserStatusCache(user.id);
    } catch (err) {
      log.error({ err }, "Failed to invalidate user status cache");
    }

    // Notify messaging service about account disabled to disconnect active sockets in real time
    try {
      const { getConfig } = await import("@xprtlink/shared/config/loadEnv.js");
      const { internalPost } = await import("@xprtlink/shared/lib/internalFetch.js");
      const messagingUrl = getConfig("admin-service").serviceUrls.messaging;
      await internalPost(messagingUrl, "/api/internal/events/account-disabled", { userId: user.id });
    } catch (err) {
      log.error({ err }, "Failed to notify messaging service about deleted customer account");
    }

    // Log admin audit action
    await logAdminAction(req, "customer.delete", "User", user.id, {
      email: user.email,
      phone: user.phone,
      customerProfileId: user.customerProfile.id,
      firstName: user.customerProfile.firstName,
      lastName: user.customerProfile.lastName,
    });

    return ResponseFormatter.success(res, {
      message: getMessage("customerDeleted"),
      data: { id: user.id, status: "deleted" },
    });
  } catch (err) {
    next(err);
  }
}
