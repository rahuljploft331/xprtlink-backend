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
      db.review.count({ where }),
      db.review.findMany({
        where, skip, take: limit, orderBy: { createdAt: "desc" },
        include: {
          expert: { select: { firstName: true, lastName: true } },
          customer: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);
    return ResponseFormatter.paginated(res, { items, page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const db = getDb();
    const r = await db.review.findUnique({
      where: { id: req.params.id },
      include: { expert: true, customer: true, consultation: true },
    });
    if (!r) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    return ResponseFormatter.success(res, { data: r });
  } catch (err) { next(err); }
}

export async function hide(req, res, next) {
  try {
    const db = getDb();
    const r = await db.review.update({ where: { id: req.params.id }, data: { status: "hidden" } });
    return ResponseFormatter.success(res, { message: getMessage("reviewHidden"), data: r });
  } catch (err) { next(err); }
}

export async function publish(req, res, next) {
  try {
    const db = getDb();
    const r = await db.review.update({ where: { id: req.params.id }, data: { status: "published" } });
    return ResponseFormatter.success(res, { message: getMessage("reviewPublished"), data: r });
  } catch (err) { next(err); }
}
