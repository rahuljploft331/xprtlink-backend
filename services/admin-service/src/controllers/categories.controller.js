import { z } from "zod";
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

// ─── Expert "my category isn't listed" suggestions ───────────────────────────
// Suggestions are free text on expert_profiles.other_category. Approving one creates (or reuses) a
// Category and attaches every expert who typed it; dismissing just clears the text (abuse/typos).

const suggestionActionSchema = z.object({ suggestion: z.string().trim().min(1).max(200) });
const approveSuggestionSchema = suggestionActionSchema.extend({
  name: z.string().trim().min(3).max(120).optional(), // final category name; defaults to the suggestion
});

const slugify = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const matching = (text) => ({ otherCategory: { equals: text, mode: "insensitive" } });

export async function listSuggestions(_req, res, next) {
  try {
    const experts = await getDb().expertProfile.findMany({
      where: { otherCategory: { not: null } },
      select: { id: true, firstName: true, lastName: true, otherCategory: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    const groups = new Map();
    for (const e of experts) {
      const key = e.otherCategory.trim().toLowerCase();
      if (!key) continue;
      const g = groups.get(key) ?? { suggestion: e.otherCategory.trim(), count: 0, experts: [], lastSuggestedAt: e.updatedAt };
      g.count += 1;
      if (g.experts.length < 5) g.experts.push({ id: e.id, name: `${e.firstName} ${e.lastName}` });
      groups.set(key, g);
    }
    const items = [...groups.values()].sort((a, b) => b.count - a.count);
    return ResponseFormatter.success(res, { data: { items } });
  } catch (err) { next(err); }
}

export async function approveSuggestion(req, res, next) {
  try {
    const { suggestion, name = suggestion } = approveSuggestionSchema.parse(req.body);
    const db = getDb();
    const result = await db.$transaction(async (tx) => {
      const experts = await tx.expertProfile.findMany({ where: matching(suggestion), select: { id: true } });
      if (experts.length === 0) return null;

      let category = await tx.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
      const created = !category;
      if (!category) {
        const base = slugify(name) || "category";
        let slug = base;
        for (let i = 2; await tx.category.findUnique({ where: { slug } }); i += 1) slug = `${base}-${i}`;
        const { _max } = await tx.category.aggregate({ _max: { sortOrder: true } });
        category = await tx.category.create({ data: { name, slug, sortOrder: (_max.sortOrder ?? 0) + 1, isActive: true } });
      }
      for (const { id } of experts) {
        await tx.expertProfile.update({
          where: { id },
          data: { categories: { connect: { id: category.id } }, otherCategory: null },
        });
      }
      return { category, created, expertCount: experts.length };
    });
    if (!result) {
      return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    }
    await logAdminAction(req, "category.suggestion.approve", "Category", result.category.id, {
      suggestion, name, created: result.created, expertCount: result.expertCount,
    });
    return ResponseFormatter.success(res, { data: result });
  } catch (err) { next(err); }
}

export async function dismissSuggestion(req, res, next) {
  try {
    const { suggestion } = suggestionActionSchema.parse(req.body);
    const { count } = await getDb().expertProfile.updateMany({ where: matching(suggestion), data: { otherCategory: null } });
    await logAdminAction(req, "category.suggestion.dismiss", "Category", "suggestion", { suggestion, expertCount: count });
    return ResponseFormatter.success(res, { data: { expertCount: count } });
  } catch (err) { next(err); }
}
