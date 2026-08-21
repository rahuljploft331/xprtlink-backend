import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


export async function list(_req, res, next) {
  try {
    const db = getDb();
    const items = await db.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { experts: true } } },
    });
    const mapped = items.map((c) => ({ ...c, expertCount: c._count.experts }));
    return ResponseFormatter.success(res, { data: { items: mapped } });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const db = getDb();
    const c = await db.category.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { experts: true } } },
    });
    if (!c) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    return ResponseFormatter.success(res, { data: c });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const db = getDb();
    const { name, slug, sortOrder = 0, isActive = true } = req.body;
    const c = await db.category.create({ data: { name, slug, sortOrder, isActive } });
    return ResponseFormatter.success(res, { data: c, status: 201 });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const db = getDb();
    const { name, isActive, sortOrder } = req.body;
    const c = await db.category.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      },
    });
    return ResponseFormatter.success(res, { data: c });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const db = getDb();
    await db.category.delete({ where: { id: req.params.id } });
    return ResponseFormatter.success(res, { message: getMessage("categoryDeleted") });
  } catch (err) { next(err); }
}
