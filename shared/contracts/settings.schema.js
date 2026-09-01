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
export const PAYOUT_SCHEDULES = ["daily", "weekly", "monthly"];

/** Defaults returned when a row has never been written (fresh DB). */
export const PLATFORM_SETTING_DEFAULTS = {
  commissionPercent: 15,
  maintenanceMode: false,
  supportEmail: "support@xpertlink.com",
  payoutSchedule: "weekly",
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
  payoutSchedule: z.enum(PAYOUT_SCHEDULES).optional(),
});

/**
 * PUT /admin/settings/password — an admin changing their OWN password.
 * Minimum length matches `createAdminSchema` and the portal's client-side check.
 */
export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters long"),
});
