import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { resolveMediaUrl } from "@xprtlink/shared/mappers/common.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logAdminAction } from "#utils/audit.js";
import { adminSetFeaturedSchema } from "@xprtlink/shared/contracts/expert.schema.js";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


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
          categories: { select: { id: true, name: true, slug: true } },
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
      categories: e.categories,
      verificationStatus: e.verificationStatus,
      availabilityStatus: e.availabilityStatus,
      ratingAvg: e.ratingAvg,
      ratingCount: e.ratingCount,
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
