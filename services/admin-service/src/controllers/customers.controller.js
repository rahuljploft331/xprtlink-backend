import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { resolveMediaUrl } from "@xprtlink/shared/mappers/common.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


/** GET /api/v1/admin/customers */
export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const q = req.query.q?.trim();

    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { customerProfile: { firstName: { contains: q, mode: "insensitive" } } },
            { customerProfile: { lastName: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {};

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
    const customer = await db.user.update({
      where: { id: req.params.id },
      data: req.body,
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
    return ResponseFormatter.success(res, { data: customer });
  } catch (err) {
    next(err);
  }
}

export async function getTransactions(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    
    const user = await db.user.findUnique({ where: { id: req.params.id }, include: { customerProfile: true } });
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

    const formattedItems = items.map(t => ({
      id: t.id,
      type: t.type,
      amountCents: t.amountCents,
      currency: t.currency,
      status: t.status,
      expertName: t.consultationCharge ? `${t.consultationCharge.consultation.expert.firstName} ${t.consultationCharge.consultation.expert.lastName}` : null,
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
