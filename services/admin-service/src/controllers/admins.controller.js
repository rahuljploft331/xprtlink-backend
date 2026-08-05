import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { hashPassword } from "@xprtlink/shared/auth/password.js";
import { adminUsers } from "@xprtlink/shared/db/repositories/admin/index.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";

export async function list(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const [total, items] = await Promise.all([
      adminUsers().count(),
      adminUsers().findMany({
        skip, take: limit, orderBy: { createdAt: "desc" },
        include: { permissions: true },
      }),
    ]);
    const safe = items.map(({ passwordHash: _ph, ...a }) => ({
      ...a,
      permissionsMap: a.permissions.reduce((acc, p) => { acc[p.module] = p.level; return acc; }, {}),
    }));
    return ResponseFormatter.paginated(res, { items: safe, page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const admin = await adminUsers().findUnique({
      where: { id: req.params.id }, include: { permissions: true },
    });
    if (!admin) return res.status(404).json({ success: false, message: "Not found", code: "NOT_FOUND" });
    const { passwordHash: _ph, ...safe } = admin;
    return ResponseFormatter.success(res, { data: safe });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const { name, email, password, role = "subadmin" } = req.body;
    const passwordHash = await hashPassword(password);
    const admin = await adminUsers().create({
      data: { name, email: email.toLowerCase(), passwordHash, role },
    });
    const { passwordHash: _ph, ...safe } = admin;
    return ResponseFormatter.success(res, { data: safe, status: 201 });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const { name, status } = req.body;
    const admin = await adminUsers().update({
      where: { id: req.params.id },
      data: { ...(name ? { name } : {}), ...(status ? { status } : {}) },
    });
    const { passwordHash: _ph, ...safe } = admin;
    return ResponseFormatter.success(res, { data: safe });
  } catch (err) { next(err); }
}

export async function setPermissions(req, res, next) {
  try {
    const { permissions } = req.body; // { moduleName: "view"|"edit"|"none" }
    const db = getDb();
    await db.$transaction(
      Object.entries(permissions).map(([module, level]) =>
        db.adminPermission.upsert({
          where: { adminUserId_module: { adminUserId: req.params.id, module } },
          create: { adminUserId: req.params.id, module, level },
          update: { level },
        })
      )
    );
    return ResponseFormatter.success(res, { message: "Permissions updated" });
  } catch (err) { next(err); }
}
