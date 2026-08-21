import { getDb } from "@xprtlink/shared/config/db.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { resolveMediaUrl } from "@xprtlink/shared/mappers/common.js";

/** GET /api/v1/admin/experts */
export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const q = req.query.q?.trim();
    const status = req.query.status;

    const where = {};
    if (status) where.verificationStatus = status;
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
          category: { select: { id: true, name: true } },
          subscriptions: {
            where: { status: "active" },
            take: 1,
            include: { plan: { select: { name: true, code: true } } },
          },
        },
      }),
    ]);

    const items = experts.map((e) => ({
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      avatarUrl: resolveMediaUrl(e.avatarMedia?.storageKey),
      category: e.category,
      verificationStatus: e.verificationStatus,
      availabilityStatus: e.availabilityStatus,
      ratingAvg: e.ratingAvg,
      ratingCount: e.ratingCount,
      activeSubscription: e.subscriptions[0] ?? null,
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
    const db = getDb();
    const expert = await db.expertProfile.findUnique({
      where: { id: req.params.id },
      include: {
        avatarMedia: true,
        category: true,
        verifications: { include: { documents: true }, orderBy: { createdAt: "desc" }, take: 5 },
        subscriptions: { include: { plan: true }, orderBy: { createdAt: "desc" }, take: 1 },
        reviews: { take: 10, orderBy: { createdAt: "desc" } },
        payouts: { take: 5, orderBy: { createdAt: "desc" } },
        user: { select: { email: true, phone: true, status: true, createdAt: true } },
      },
    });
    if (!expert) {
      return res.status(404).json({ success: false, message: "Expert not found", code: "NOT_FOUND" });
    }
    if (expert) {
      expert.avatarUrl = resolveMediaUrl(expert.avatarMedia?.storageKey);
    }
    return ResponseFormatter.success(res, { data: expert });
  } catch (err) {
    next(err);
  }
}
