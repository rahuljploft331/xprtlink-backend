import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";

export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const status = req.query.status;
    const where = status ? { status } : {};
    const [total, items] = await Promise.all([
      db.expertPayout.count({ where }),
      db.expertPayout.findMany({
        where, skip, take: limit, orderBy: { createdAt: "desc" },
        include: { expert: { select: { firstName: true, lastName: true } } },
      }),
    ]);
    return ResponseFormatter.paginated(res, { items, page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const db = getDb();
    const p = await db.expertPayout.findUnique({
      where: { id: req.params.id },
      include: { expert: true },
    });
    if (!p) return res.status(404).json({ success: false, message: "Not found", code: "NOT_FOUND" });
    return ResponseFormatter.success(res, { data: p });
  } catch (err) { next(err); }
}

export async function markPaid(req, res, next) {
  try {
    const db = getDb();
    const p = await db.expertPayout.update({
      where: { id: req.params.id },
      data: { status: "paid", updatedAt: new Date() },
    });
    return ResponseFormatter.success(res, { message: "Payout marked as paid", data: p });
  } catch (err) { next(err); }
}
