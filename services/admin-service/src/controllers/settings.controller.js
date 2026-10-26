import { getDb } from "@xprtlink/shared/db/getClient.js";
import { platformSettings, appConfig } from "@xprtlink/shared/db/repositories/catalog/index.js";
import { toAppConfigDto } from "@xprtlink/shared/mappers/media.mapper.js";
import { adminUsers } from "@xprtlink/shared/db/repositories/admin/index.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { hashPassword, verifyPassword } from "@xprtlink/shared/auth/password.js";
import { encryptPassword } from "@xprtlink/shared/utils/passwordVault.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { badRequest, unauthorized } from "@xprtlink/shared/utils/errors.js";
import {
  PLATFORM_SETTING_DEFAULTS,
  updatePlatformSettingsSchema,
  updateAppControlSchema,
  changeOwnPasswordSchema,
  compareVersions,
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
  if (key === "payoutSchedule") {
    // Now an integer number of days. Legacy rows may hold the old enum
    // strings ("weekly" etc.) — map those forward, else parse the number,
    // else fall back to the default cadence.
    const legacyDays = { daily: 1, weekly: 7, monthly: 30 };
    if (typeof value === "string" && value in legacyDays) return legacyDays[value];
    const num = Number(value);
    return Number.isInteger(num) && num >= 1 ? num : PLATFORM_SETTING_DEFAULTS[key];
  }
  if (key === "maintenanceMode") {
    if (typeof value === "boolean") return value;
    return value === "true" || value === 1;
  }
  if (key === "featuredExpertWeights") {
    return typeof value === "object" ? value : PLATFORM_SETTING_DEFAULTS[key];
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
      throw badRequest("atLeastOneSettingRequired", "VALIDATION_ERROR");
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

/** Admin view of the app-control payload: same shape the mobile app reads. */
async function readAppControl() {
  const [config, row] = await Promise.all([
    appConfig().findFirst({ orderBy: { updatedAt: "desc" } }),
    platformSettings().findUnique({ where: { key: "maintenanceMode" } }),
  ]);
  const dto = toAppConfigDto(config, { maintenanceMode: normalize("maintenanceMode", row?.value) });
  return {
    maintenanceMode: dto.maintenanceMode,
    maintenanceMessage: dto.maintenanceMessage,
    ios: dto.ios,
    android: dto.android,
  };
}

/** GET /api/v1/admin/settings/app-config */
export async function getAppControl(req, res, next) {
  try {
    return ResponseFormatter.success(res, {
      message: getMessage("appControlLoaded"),
      data: await readAppControl(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/admin/settings/app-config
 * Partial update across two stores: `maintenanceMode` is a PlatformSetting row
 * (engagement-service gates bookings on it); message + version gates are columns
 * on the single AppConfig row, which is updated in place (created on first save).
 */
export async function updateAppControl(req, res, next) {
  try {
    const parsed = updateAppControlSchema.parse(req.body);
    const { maintenanceMode, maintenanceMessage, ios, android } = parsed;

    const data = {};
    if (maintenanceMessage !== undefined) data.maintenanceMessage = maintenanceMessage;
    for (const [prefix, gate] of [["ios", ios], ["android", android]]) {
      if (!gate) continue;
      if (gate.minVersion !== undefined) data[`${prefix}MinVersion`] = gate.minVersion;
      if (gate.latestVersion !== undefined) data[`${prefix}LatestVersion`] = gate.latestVersion;
      if (gate.storeUrl !== undefined) data[`${prefix}StoreUrl`] = gate.storeUrl;
    }

    if (maintenanceMode === undefined && Object.keys(data).length === 0) {
      throw badRequest("atLeastOneSettingRequired", "VALIDATION_ERROR");
    }

    // A partial PATCH can pass the per-platform check while contradicting the
    // stored half (e.g. raising min above the saved latest) — re-check the merged result.
    const existing = await appConfig().findFirst({ orderBy: { updatedAt: "desc" } });
    for (const [prefix, label] of [["ios", "iOS"], ["android", "Android"]]) {
      const min = data[`${prefix}MinVersion`] !== undefined ? data[`${prefix}MinVersion`] : existing?.[`${prefix}MinVersion`];
      const latest = data[`${prefix}LatestVersion`] !== undefined ? data[`${prefix}LatestVersion`] : existing?.[`${prefix}LatestVersion`];
      if (min && latest && compareVersions(min, latest) > 0) {
        throw badRequest("appVersionMinAboveLatest", "VALIDATION_ERROR", `${prefix}MinVersion`, { platform: label });
      }
    }

    const db = getDb();
    await db.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        if (existing) {
          await tx.appConfig.update({ where: { id: existing.id }, data });
        } else {
          await tx.appConfig.create({ data: { minAppVersion: "1.0.0", ...data } });
        }
      }
      if (maintenanceMode !== undefined) {
        await tx.platformSetting.upsert({
          where: { key: "maintenanceMode" },
          create: { key: "maintenanceMode", value: maintenanceMode },
          update: { value: maintenanceMode },
        });
      }
    });

    await logAdminAction(req, "settings.app_control_update", "AppConfig", existing?.id ?? null, parsed);

    return ResponseFormatter.success(res, {
      message: getMessage("appControlUpdated"),
      data: await readAppControl(),
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
    if (!valid) return next(unauthorized("currentPasswordIncorrect"));

    await adminUsers().update({
      where: { id: admin.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        ...(admin.role === "subadmin" ? { passwordEncrypted: encryptPassword(newPassword) } : {}),
      },
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
