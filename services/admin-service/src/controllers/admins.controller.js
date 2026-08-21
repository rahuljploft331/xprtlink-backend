import crypto from "crypto";
import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { hashPassword } from "@xprtlink/shared/auth/password.js";
import { adminUsers } from "@xprtlink/shared/db/repositories/admin/index.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import {
  createAdminSchema,
  updateAdminSchema,
  setPermissionsSchema,
} from "@xprtlink/shared/contracts/admin.schema.js";
import { toAdminUserDto } from "@xprtlink/shared/mappers/admin.mapper.js";
import { logAdminAction } from "#utils/audit.js";
import { notFound, badRequest } from "@xprtlink/shared/utils/errors.js";
import { sendEmail } from "@xprtlink/shared/lib/email.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


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
    const safe = items.map(toAdminUserDto);
    return ResponseFormatter.paginated(res, { items: safe, page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const admin = await adminUsers().findUnique({
      where: { id: req.params.id }, include: { permissions: true },
    });
    if (!admin) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    return ResponseFormatter.success(res, { data: toAdminUserDto(admin) });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const { name, email, password, role } = createAdminSchema.parse(req.body);
    const passwordHash = await hashPassword(password);
    const admin = await adminUsers().create({
      data: { name, email: email.toLowerCase(), passwordHash, role },
      include: { permissions: true },
    });
    await logAdminAction(req, "admin.create", "AdminUser", admin.id, { name, email: admin.email, role });
    return ResponseFormatter.success(res, { data: toAdminUserDto(admin), status: 201 });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const { name, status } = updateAdminSchema.parse(req.body);
    const admin = await adminUsers().update({
      where: { id: req.params.id },
      data: { ...(name ? { name } : {}), ...(status ? { status } : {}) },
      include: { permissions: true },
    });
    await logAdminAction(req, "admin.update", "AdminUser", admin.id, { name, status });
    return ResponseFormatter.success(res, { data: toAdminUserDto(admin) });
  } catch (err) { next(err); }
}

function generateTempPassword() {
  // 12 chars, mixed alphanumeric — avoids visually ambiguous chars.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function resetPassword(req, res, next) {
  try {
    const admin = await adminUsers().findUnique({ where: { id: req.params.id } });
    if (!admin) throw notFound("Admin not found");
    if (admin.role === "super_admin") {
      throw badRequest("Super admin passwords can't be reset from here", "NOT_SUPPORTED");
    }

    const tempPassword = generateTempPassword();
    await adminUsers().update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(tempPassword) },
    });

    await sendEmail({
      to: admin.email,
      subject: "Your XprtLink admin password has been reset",
      text: `Hi ${admin.name},\n\nYour XprtLink admin password was reset by a super admin. Your new temporary password is:\n\n${tempPassword}\n\nPlease sign in and change it as soon as possible.`,
      html: `<p>Hi ${admin.name},</p><p>Your XprtLink admin password was reset by a super admin. Your new temporary password is:</p><p style="font-size:18px;font-weight:600;letter-spacing:1px;">${tempPassword}</p><p>Please sign in and change it as soon as possible.</p>`,
    });

    await logAdminAction(req, "admin.password_reset", "AdminUser", admin.id, { email: admin.email });
    return ResponseFormatter.success(res, { message: `Password reset. New password sent to ${admin.email}.` });
  } catch (err) { next(err); }
}

export async function setPermissions(req, res, next) {
  try {
    const { permissions } = setPermissionsSchema.parse(req.body); // { moduleName: "view"|"edit"|"none" }
    const existing = await adminUsers().findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Admin not found");

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
    await logAdminAction(req, "admin.setPermissions", "AdminUser", req.params.id, { permissions });
    return ResponseFormatter.success(res, { message: getMessage("permissionsUpdated") });
  } catch (err) { next(err); }
}
