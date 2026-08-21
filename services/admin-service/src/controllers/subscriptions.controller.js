import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const status = req.query.status;
    const where = status ? { status } : {};
    const [total, items] = await Promise.all([
      db.expertSubscription.count({ where }),
      db.expertSubscription.findMany({
        where, skip, take: limit, orderBy: { createdAt: "desc" },
        include: {
          expert: { select: { firstName: true, lastName: true } },
          plan: { select: { name: true, code: true } },
        },
      }),
    ]);
    return ResponseFormatter.paginated(res, { items, page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const db = getDb();
    const s = await db.expertSubscription.findUnique({
      where: { id: req.params.id },
      include: { expert: true, plan: true },
    });
    if (!s) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    return ResponseFormatter.success(res, { data: s });
  } catch (err) { next(err); }
}
