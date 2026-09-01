import { getDb } from "@xprtlink/shared/db/getClient.js";
import { platformSettings } from "@xprtlink/shared/db/repositories/catalog/index.js";
import { adminUsers } from "@xprtlink/shared/db/repositories/admin/index.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { hashPassword, verifyPassword } from "@xprtlink/shared/auth/password.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { badRequest, unauthorized } from "@xprtlink/shared/utils/errors.js";
import {
  PLATFORM_SETTING_DEFAULTS,
  updatePlatformSettingsSchema,
  changeOwnPasswordSchema,
} from "@xprtlink/shared/contracts/settings.schema.js";
import { logAdminAction } from "#utils/audit.js";

/**
 * The keys this endpoint owns inside the shared `PlatformSetting` key/value
 * store. Other keys may exist (catalog-service folds *every* row into the
 * mobile app-config payload) — read and write only these four so an unrelated
 * key is never clobbered or leaked through the admin portal.
 */
const SETTING_KEYS = Object.keys(PLATFORM_SETTING_DEFAULTS);

/**
 * `value` is a raw Json column, so a legacy or hand-written row can hold the
 * wrong shape. Coerce the obvious cases and fall back to the default rather
 * than handing the portal something it can't render.
 */
function normalize(key, value) {
  if (value === null || value === undefined) return PLATFORM_SETTING_DEFAULTS[key];

  if (key === "commissionPercent") {
    const num = Number(value);
    return Number.isFinite(num) ? num : PLATFORM_SETTING_DEFAULTS[key];
  }
  if (key === "maintenanceMode") {
    if (typeof value === "boolean") return value;
    return value === "true" || value === 1;
  }
  return typeof value === "string" ? value : PLATFORM_SETTING_DEFAULTS[key];
}

/**
 * GET /api/v1/admin/settings
 * Flat object of the four platform settings; missing rows fall back to
 * defaults so a freshly migrated database still renders a usable page.
 */
export async function getSettings(req, res, next) {
  try {
    const rows = await platformSettings().findMany({
      where: { key: { in: SETTING_KEYS } },
    });
    const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    const data = Object.fromEntries(
      SETTING_KEYS.map((key) => [key, normalize(key, stored[key])])
    );

    return ResponseFormatter.success(res, {
      message: getMessage("platformSettingsLoaded"),
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/admin/settings
 * Partial update — one upsert per key actually supplied, so untouched
 * settings keep their existing rows.
 */
export async function updateSettings(req, res, next) {
  try {
    const parsed = updatePlatformSettingsSchema.parse(req.body);
    const entries = Object.entries(parsed).filter(([, value]) => value !== undefined);

    if (entries.length === 0) {
      throw badRequest("At least one setting must be provided", "VALIDATION_ERROR");
    }

    const db = getDb();
    await db.$transaction(
      entries.map(([key, value]) =>
        db.platformSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        })
      )
    );

    const changed = Object.fromEntries(entries);
    await logAdminAction(req, "settings.update", "PlatformSetting", null, changed);

    // Re-read so the response reflects every key, not just the changed ones.
    const rows = await platformSettings().findMany({
      where: { key: { in: SETTING_KEYS } },
    });
    const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const data = Object.fromEntries(
      SETTING_KEYS.map((key) => [key, normalize(key, stored[key])])
    );

    return ResponseFormatter.success(res, {
      message: getMessage("platformSettingsUpdated"),
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/admin/settings/password
 * The logged-in admin changing their OWN password — distinct from
 * `PUT /admin/admins/:id/reset-password`, which is a super admin resetting
 * somebody else's. Any authenticated admin may call this; no module
 * permission is involved because it only ever touches the caller's own row.
 */
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = changeOwnPasswordSchema.parse(req.body);
    const admin = req.adminUser;

    const valid = await verifyPassword(currentPassword, admin.passwordHash);
    if (!valid) return next(unauthorized("Current password is incorrect"));

    await adminUsers().update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    // Never log password values — only who changed theirs.
    await logAdminAction(req, "settings.password_change", "AdminUser", admin.id, {
      email: admin.email,
    });

    return ResponseFormatter.success(res, { message: getMessage("passwordChanged") });
  } catch (err) {
    next(err);
  }
}
