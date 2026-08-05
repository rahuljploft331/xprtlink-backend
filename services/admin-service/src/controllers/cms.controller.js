import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

export async function list(_req, res, next) {
  try {
    const db = getDb();
    const items = await db.cmsPage.findMany({ orderBy: { updatedAt: "desc" } });
    return ResponseFormatter.success(res, { data: { items } });
  } catch (err) { next(err); }
}

export async function getBySlug(req, res, next) {
  try {
    const db = getDb();
    const page = await db.cmsPage.findUnique({ where: { slug: req.params.slug } });
    if (!page) return res.status(404).json({ success: false, message: "Not found", code: "NOT_FOUND" });
    return ResponseFormatter.success(res, { data: page });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const db = getDb();
    const { title, bodyHtml, status } = req.body;
    const page = await db.cmsPage.update({
      where: { slug: req.params.slug },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(bodyHtml !== undefined ? { bodyHtml } : {}),
        ...(status !== undefined ? { status } : {}),
        updatedByAdminId: req.adminUser.id,
      },
    });
    return ResponseFormatter.success(res, { message: "Page updated", data: page });
  } catch (err) { next(err); }
}
