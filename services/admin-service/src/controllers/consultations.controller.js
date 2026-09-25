import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { consultationDisplayStatus } from "@xprtlink/shared/mappers/consultation.mapper.js";


export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const [total, items] = await Promise.all([
      db.consultation.count(),
      db.consultation.findMany({
        skip, take: limit, orderBy: { createdAt: "desc" },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, user: { select: { id: true } } } },
          expert: { select: { id: true, firstName: true, lastName: true, userId: true } },
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
