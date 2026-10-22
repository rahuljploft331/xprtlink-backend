import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { consultationDisplayStatus } from "@xprtlink/shared/mappers/consultation.mapper.js";


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set([
  "requested",
  "ringing",
  "accepted",
  "in_progress",
  "completed",
  "declined",
  "canceled",
  "failed",
]);

export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 1000 });
    const q = req.query.q?.trim() || req.query.search?.trim();
    const status = req.query.status?.trim()?.toLowerCase();
    const startDate = req.query.startDate?.trim();
    const endDate = req.query.endDate?.trim();
    const sort = req.query.sort?.trim();
    const order = req.query.order?.trim()?.toLowerCase() === "asc" ? "asc" : "desc";

    const conditions = [];

    if (q) {
      const searchOr = [
        { customer: { firstName: { contains: q, mode: "insensitive" } } },
        { customer: { lastName: { contains: q, mode: "insensitive" } } },
        { customer: { user: { email: { contains: q, mode: "insensitive" } } } },
        { expert: { firstName: { contains: q, mode: "insensitive" } } },
        { expert: { lastName: { contains: q, mode: "insensitive" } } },
        { expert: { user: { email: { contains: q, mode: "insensitive" } } } },
      ];
      if (UUID_RE.test(q)) {
        searchOr.push({ id: q });
      }
      conditions.push({ OR: searchOr });
    }

    if (status && status !== "all") {
      if (status === "completed") {
        conditions.push({ status: "completed", startedAt: { not: null } });
      } else if (status === "failed") {
        conditions.push({
          OR: [{ status: "failed" }, { status: "completed", startedAt: null }],
        });
      } else if (VALID_STATUSES.has(status)) {
        conditions.push({ status });
      }
    }

    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      if (!isNaN(start.getTime())) {
        conditions.push({ createdAt: { gte: start } });
      }
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      if (!isNaN(end.getTime())) {
        conditions.push({ createdAt: { lte: end } });
      }
    }

    const where = conditions.length > 0 ? { AND: conditions } : {};

    let orderBy = { createdAt: "desc" };
    if (sort === "createdAt" || sort === "date") {
      orderBy = { createdAt: order };
    } else if (sort === "duration" || sort === "durationSeconds") {
      orderBy = { durationSeconds: order };
    } else if (sort === "status") {
      orderBy = { status: order };
    }

    const [total, items] = await Promise.all([
      db.consultation.count({ where }),
      db.consultation.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, user: { select: { id: true, email: true } } } },
          expert: { select: { id: true, firstName: true, lastName: true, userId: true, user: { select: { id: true, email: true } } } },
          charge: { include: { transaction: true } },
        },
      }),
    ]);
    // A call that never connected must not be reported as "Completed".
    const withDisplayStatus = items.map((c) => ({ ...c, status: consultationDisplayStatus(c) }));
    return ResponseFormatter.paginated(res, { items: withDisplayStatus, page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const db = getDb();
    const c = await db.consultation.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { include: { user: { select: { id: true, email: true, phone: true } } } },
        expert: { include: { user: { select: { email: true } } } },
        review: true,
        charge: { include: { transaction: true } },
      },
    });
    if (!c) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    // A call that never connected must not be reported as "Completed".
    const data = { ...c, status: consultationDisplayStatus(c) };
    return ResponseFormatter.success(res, { data });
  } catch (err) { next(err); }
}
