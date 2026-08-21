import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const [total, items] = await Promise.all([
      db.transaction.count(),
      db.transaction.findMany({
        skip, take: limit, orderBy: { createdAt: "desc" },
        include: { consultationCharge: { include: { consultation: true } } },
      }),
    ]);
    const mapped = items.map((t) => ({
      ...t,
      party: t.consultationCharge?.consultation
        ? `Consultation #${t.consultationCharge.consultation.id.slice(-6)}`
        : t.type,
    }));
    return ResponseFormatter.paginated(res, { items: mapped, page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const db = getDb();
    const t = await db.transaction.findUnique({
      where: { id: req.params.id },
      include: { consultationCharge: { include: { consultation: { include: { customer: true, expert: true } } } } },
    });
    if (!t) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    return ResponseFormatter.success(res, { data: t });
  } catch (err) { next(err); }
}
