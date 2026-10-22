import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logAdminAction } from "#utils/audit.js";
import {
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
  reorderCategoriesRequestSchema,
} from "@xprtlink/shared/contracts/catalog.schema.js";


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
    const { name, slug, sortOrder, isActive } = createCategoryRequestSchema.parse(req.body);
    const db = getDb();
    const c = await db.category.create({ data: { name, slug, sortOrder, isActive } });
    await logAdminAction(req, "category.create", "Category", c.id, { name, slug });
    return ResponseFormatter.success(res, { data: c, status: 201 });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const body = updateCategoryRequestSchema.parse(req.body);
    const db = getDb();
    const existing = await db.category.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { experts: true } } },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    }
    if (existing._count.experts > 0 && body.slug !== undefined && body.slug !== existing.slug) {
      return res.status(400).json({
        success: false,
        message: getMessage("categorySlugCannotBeChangedWhenInUse"),
        code: "CATEGORY_IN_USE",
      });
    }

    const c = await db.category.update({
      where: { id: req.params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined && (existing._count.experts === 0 || body.slug === existing.slug) ? { slug: body.slug } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      },
    });
    await logAdminAction(req, "category.update", "Category", c.id, body);
    return ResponseFormatter.success(res, { data: c });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const db = getDb();
    const existing = await db.category.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { experts: true } } },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    }
    if (existing._count.experts > 0) {
      return res.status(409).json({
        success: false,
        message: getMessage("categoryInUseCannotDelete", { count: existing._count.experts }),
        code: "CATEGORY_IN_USE",
      });
    }
    const bannerCount = await db.expertBanner.count({
      where: { targetCategoryId: req.params.id },
    });
    if (bannerCount > 0) {
      return res.status(409).json({
        success: false,
        message: getMessage("categoryInUseByBannersCannotDelete", { count: bannerCount }),
        code: "CATEGORY_IN_USE",
      });
    }

    await db.category.delete({ where: { id: req.params.id } });
    await logAdminAction(req, "category.delete", "Category", req.params.id, { name: existing.name });
    return ResponseFormatter.success(res, { message: getMessage("categoryDeleted") });
  } catch (err) { next(err); }
}

export async function reorder(req, res, next) {
  try {
    const { items } = reorderCategoriesRequestSchema.parse(req.body);
    const db = getDb();
    await db.$transaction(
      items.map(({ id, sortOrder }) =>
        db.category.update({ where: { id }, data: { sortOrder } })
      )
    );
    await logAdminAction(req, "category.reorder", "Category", "batch", { count: items.length });
    return ResponseFormatter.success(res, { message: getMessage("categoryOrderSaved") });
  } catch (err) { next(err); }
}
