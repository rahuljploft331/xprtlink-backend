import { z } from "zod";
import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";

const createCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  slug: z.string().min(1, "Slug is required").max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens"),
  sortOrder: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens").optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});


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
    const { name, slug, sortOrder, isActive } = createCategorySchema.parse(req.body);
    const db = getDb();
    const c = await db.category.create({ data: { name, slug, sortOrder, isActive } });
    return ResponseFormatter.success(res, { data: c, status: 201 });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const body = updateCategorySchema.parse(req.body);
    const db = getDb();
    const c = await db.category.update({
      where: { id: req.params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
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
