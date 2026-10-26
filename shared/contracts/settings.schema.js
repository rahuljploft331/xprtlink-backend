import { z } from "zod";

/**
 * Platform settings (MFS §12.12) — key/value rows in `PlatformSetting`.
 *
 * Key names are a contract in three directions: the admin portal's settings
 * page, the rows stored in `platform_settings`, and catalog-service's
 * `getAppConfig()` (which folds every row into the mobile app-config payload,
 * e.g. `maintenanceMode`). Renaming a key silently changes the mobile payload —
 * add new keys instead.
 */
/**
 * `payoutSchedule` is the payout cadence expressed as an integer number of DAYS.
 * The payout-run job reads this to size its rolling settlement window (e.g. 7 = weekly,
 * 5 = every 5 days). Admin-configurable to any N in [1, 90]. Default 7.
 */
export const PAYOUT_SCHEDULE_MIN_DAYS = 1;
export const PAYOUT_SCHEDULE_MAX_DAYS = 90;
export const PAYOUT_SCHEDULE_DEFAULT_DAYS = 7;

/** Defaults returned when a row has never been written (fresh DB). */
export const PLATFORM_SETTING_DEFAULTS = {
  commissionPercent: 15,
  maintenanceMode: false,
  supportEmail: "support@xpertlink.com",
  payoutSchedule: PAYOUT_SCHEDULE_DEFAULT_DAYS,
  featuredExpertWeights: {
    tierWeight: 100,
    ratingWeight: 10,
  },
};

/**
 * PATCH /admin/settings — partial update; every field is optional and only the
 * keys actually present are written. Values are stored raw in the Json column,
 * so no nulls: absent means "leave the existing row alone".
 */
export const updatePlatformSettingsSchema = z.object({
  commissionPercent: z
    .number()
    .min(0, "commissionPercent must be between 0 and 100")
    .max(100, "commissionPercent must be between 0 and 100")
    .optional(),
  maintenanceMode: z.boolean().optional(),
  supportEmail: z.string().email("supportEmail must be a valid email address").optional(),
  // Older portal builds sent the legacy enum strings — map them (and numeric
  // strings) to days so a stale client can't make the whole settings save fail.
  payoutSchedule: z.preprocess(
    (value) => {
      const legacyDays = { daily: 1, weekly: 7, monthly: 30 };
      if (typeof value === "string" && value in legacyDays) return legacyDays[value];
      if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
      return value;
    },
    z
    .number()
    .int("payoutSchedule must be a whole number of days")
    .min(PAYOUT_SCHEDULE_MIN_DAYS, `payoutSchedule must be between ${PAYOUT_SCHEDULE_MIN_DAYS} and ${PAYOUT_SCHEDULE_MAX_DAYS} days`)
    .max(PAYOUT_SCHEDULE_MAX_DAYS, `payoutSchedule must be between ${PAYOUT_SCHEDULE_MIN_DAYS} and ${PAYOUT_SCHEDULE_MAX_DAYS} days`)
  ).optional(),
  featuredExpertWeights: z.object({
    tierWeight: z.number().min(0),
    ratingWeight: z.number().min(0),
  }).optional(),
});

/**
 * PUT /admin/settings/password — an admin changing their OWN password.
 * Minimum length matches `createAdminSchema` and the portal's client-side check.
 */
export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters long")
    .regex(/^\S+$/, "Password cannot contain spaces"),
});

/**
 * App control (maintenance + update gates) — PATCH /admin/settings/app-config.
 *
 * Per platform: `minVersion` is the blocking floor (force update), `latestVersion`
 * the soft "update available" prompt. A platform releases on its own schedule, so
 * each is gated independently — raising iOS must never lock out Android users.
 * Empty string / null clears a field. `maintenanceMode` stays in PlatformSetting
 * (engagement-service reads that key); `maintenanceMessage` lives on AppConfig.
 */
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Compare dotted numeric versions; "1.10.0" > "1.9.0". */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

const nullableVersion = (label) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().regex(VERSION_RE, `${label} must look like 1.2.3`).nullable()
  );

const nullableUrl = (label) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().url(`${label} must be a valid URL`).max(500).nullable()
  );

const platformGateSchema = (name) =>
  z
    .object({
      minVersion: nullableVersion(`${name} minimum version`).optional(),
      latestVersion: nullableVersion(`${name} latest version`).optional(),
      storeUrl: nullableUrl(`${name} store URL`).optional(),
    })
    .refine(
      (g) => !g.minVersion || !g.latestVersion || compareVersions(g.minVersion, g.latestVersion) <= 0,
      { message: `${name} minimum version cannot be higher than the latest version`, path: ["minVersion"] }
    );

export const updateAppControlSchema = z.object({
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(500, "Message must be 500 characters or fewer").nullable()
  ).optional(),
  ios: platformGateSchema("iOS").optional(),
  android: platformGateSchema("Android").optional(),
});
