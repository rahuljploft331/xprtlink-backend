import crypto from "crypto";
import { z } from "zod";
import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { hashPassword } from "@xprtlink/shared/auth/password.js";
import { encryptPassword } from "@xprtlink/shared/utils/passwordVault.js";
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
import { sendEmail, renderEmailTemplate, escapeHtml } from "@xprtlink/shared/lib/email.js";
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
    const { name, email, password, role, status, permissions } = createAdminSchema.parse(req.body);
    const passwordHash = await hashPassword(password);
    const db = getDb();
    const admin = await db.$transaction(async (tx) => {
      const created = await tx.adminUser.create({
        data: {
          name,
          email: email.toLowerCase(),
          passwordHash,
          passwordEncrypted: role === "subadmin" ? encryptPassword(password) : null,
          role,
          status: status || "active",
        },
      });

      if (permissions && Object.keys(permissions).length > 0) {
        await Promise.all(
          Object.entries(permissions).map(([module, level]) =>
            tx.adminPermission.create({
              data: { adminUserId: created.id, module, level },
            })
          )
        );
      }

      return tx.adminUser.findUnique({
        where: { id: created.id },
        include: { permissions: true },
      });
    });

    await logAdminAction(req, "admin.create", "AdminUser", admin.id, {
      name,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      permissions,
    });

    // Email the new subadmin their login credentials; creation must not fail if mail does.
    try {
      const html = await renderEmailTemplate({
        title: "Your XprtLink admin account",
        bodyHtml: `<p>Hi ${escapeHtml(name)},</p><p>A super admin has created an XprtLink admin account for you. Use these credentials to sign in:</p><p><strong>Email:</strong> ${escapeHtml(admin.email)}<br/><strong>Password:</strong> <span style="font-size:16px;font-weight:600;letter-spacing:1px;">${escapeHtml(password)}</span></p><p><a href="${process.env.ADMIN_PORTAL_URL || "https://devadmin.xprtlink.com"}" style="display:inline-block;padding:10px 24px;background:#1e3a5f;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Open Admin Portal</a></p><p>Please change your password after signing in.</p>`,
      });
      await sendEmail({ category: "admin", sensitive: true,
        to: admin.email,
        subject: "Your XprtLink admin account",
        text: `Hi ${name},\n\nA super admin has created an XprtLink admin account for you.\n\nEmail: ${admin.email}\nPassword: ${password}\n\nSign in here: ${process.env.ADMIN_PORTAL_URL || "https://devadmin.xprtlink.com"}\n\nPlease change your password after signing in.`,
        html,
      });
    } catch (mailErr) {
      console.error("[admin.create] credentials email failed:", mailErr?.message);
    }
    return ResponseFormatter.success(res, { data: toAdminUserDto(admin), status: 201 });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const { name, status, avatarUrl, password } = updateAdminSchema.parse(req.body);
    const existing = await adminUsers().findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("adminNotFound");

    const updateData = {
      ...(name ? { name } : {}),
      ...(status ? { status } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    };

    if (password) {
      updateData.passwordHash = await hashPassword(password);
      if (existing.role === "subadmin") {
        updateData.passwordEncrypted = encryptPassword(password);
      }
    }

    const admin = await adminUsers().update({
      where: { id: req.params.id },
      data: updateData,
      include: { permissions: true },
    });
    await logAdminAction(req, "admin.update", "AdminUser", admin.id, {
      name,
      status,
      passwordChanged: Boolean(password),
    });
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
    if (!admin) throw notFound("adminNotFound");
    if (admin.role === "super_admin") {
      throw badRequest("superAdminPasswordResetNotSupported", "NOT_SUPPORTED");
    }

    const tempPassword = generateTempPassword();
    await adminUsers().update({
      where: { id: admin.id },
      data: {
        passwordHash: await hashPassword(tempPassword),
        passwordEncrypted: encryptPassword(tempPassword),
      },
    });

    const html = await renderEmailTemplate({
      title: "Your admin password has been reset",
      bodyHtml: `<p>Hi ${escapeHtml(admin.name)},</p><p>Your XprtLink admin password was reset by a super admin. Your new temporary password is:</p><p style="font-size:18px;font-weight:600;letter-spacing:1px;">${tempPassword}</p><p>Please sign in and change it as soon as possible.</p>`,
    });

    await sendEmail({ category: "admin", sensitive: true,
      to: admin.email,
      subject: "Your XprtLink admin password has been reset",
      text: `Hi ${admin.name},\n\nYour XprtLink admin password was reset by a super admin. Your new temporary password is:\n\n${tempPassword}\n\nPlease sign in and change it as soon as possible.`,
      html,
    });

    await logAdminAction(req, "admin.password_reset", "AdminUser", admin.id, { email: admin.email });
    return ResponseFormatter.success(res, {
      data: { tempPassword },
      message: getMessage("adminPasswordResetEmailed", { email: admin.email }),
    });
  } catch (err) { next(err); }
}

const INVITE_TTL_HOURS = 72;
const INVITE_PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?]).{8,}$/;

const sendInviteSchema = z.object({
  name: z.string().min(3).max(120),
  email: z.string().email().max(320).transform((v) => v.toLowerCase()),
  permissions: z.record(z.string(), z.enum(["view", "edit", "none"])).optional(),
});

export async function sendInvite(req, res, next) {
  try {
    const { name, email, permissions } = sendInviteSchema.parse(req.body);
    const db = getDb();

    // Block if email is already an active admin
    const existing = await db.adminUser.findFirst({ where: { email } });
    if (existing) throw badRequest("emailAlreadyAdminUser", "EMAIL_IN_USE");

    // Mark any previous unused invites for this email as expired
    await db.adminInvite.updateMany({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    await db.adminInvite.create({
      data: {
        token,
        email,
        name,
        permissions: permissions ?? {},
        expiresAt,
        invitedById: req.adminUser.id,
      },
    });

    const acceptUrl = `${process.env.ADMIN_PORTAL_URL ?? "https://devadmin.xprtlink.com"}/invite/${token}`;
    const html = await renderEmailTemplate({
      title: "You've been invited to XprtLink Admin",
      bodyHtml: `<p>Hi ${escapeHtml(name)},</p><p>You've been invited to join the XprtLink admin portal. Click the button below to set your password and activate your account.</p><p style="color:#6b7280;font-size:12px;">This invitation link expires in ${INVITE_TTL_HOURS} hours.</p>`,
      ctaText: "Accept Invitation",
      ctaUrl: acceptUrl,
    });
    await sendEmail({
      category: "admin",
      sensitive: false,
      to: email,
      subject: "You're invited to XprtLink Admin",
      text: `Hi ${name},\n\nYou've been invited to join the XprtLink admin portal. Accept your invitation here:\n\n${acceptUrl}\n\nThis link expires in ${INVITE_TTL_HOURS} hours.`,
      html,
    });

    await logAdminAction(req, "admin.invite", "AdminInvite", null, { name, email });
    return ResponseFormatter.success(res, {
      message: `Invitation sent to ${email}. Link expires in ${INVITE_TTL_HOURS} hours.`,
    });
  } catch (err) { next(err); }
}

export async function checkInvite(req, res, next) {
  try {
    const db = getDb();
    const invite = await db.adminInvite.findUnique({ where: { token: req.params.token } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      return res.status(404).json({ success: false, message: "This invitation link is invalid or has expired." });
    }
    return ResponseFormatter.success(res, { data: { name: invite.name, email: invite.email } });
  } catch (err) { next(err); }
}

const acceptInviteSchema = z.object({
  password: z.string().min(8).max(128),
});

export async function acceptInvite(req, res, next) {
  try {
    const { password } = acceptInviteSchema.parse(req.body);
    if (!INVITE_PASSWORD_RE.test(password)) {
      return res.status(422).json({ success: false, field: "password", message: "Password must be at least 8 characters and include an uppercase letter, a number, and a special character." });
    }

    const db = getDb();
    const invite = await db.adminInvite.findUnique({ where: { token: req.params.token } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      return res.status(404).json({ success: false, message: "This invitation link is invalid or has expired." });
    }

    const existing = await db.adminUser.findFirst({ where: { email: invite.email } });
    if (existing) {
      await db.adminInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
      return res.status(409).json({ success: false, message: "An account with this email already exists. Please sign in." });
    }

    const passwordHash = await hashPassword(password);
    const admin = await db.$transaction(async (tx) => {
      const created = await tx.adminUser.create({
        data: {
          name: invite.name,
          email: invite.email,
          passwordHash,
          passwordEncrypted: encryptPassword(password),
          role: "subadmin",
          status: "active",
        },
      });

      const permissions = invite.permissions ?? {};
      if (Object.keys(permissions).length > 0) {
        await Promise.all(
          Object.entries(permissions).map(([module, level]) =>
            tx.adminPermission.create({ data: { adminUserId: created.id, module, level } })
          )
        );
      }

      await tx.adminInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
      return tx.adminUser.findUnique({ where: { id: created.id }, include: { permissions: true } });
    });

    return ResponseFormatter.success(res, {
      data: toAdminUserDto(admin),
      message: "Account created successfully. You can now sign in.",
      status: 201,
    });
  } catch (err) { next(err); }
}

export async function setPermissions(req, res, next) {
  try {
    const { permissions } = setPermissionsSchema.parse(req.body); // { moduleName: "view"|"edit"|"none" }
    const existing = await adminUsers().findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("adminNotFound");

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
