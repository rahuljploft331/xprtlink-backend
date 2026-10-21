import { ROLES } from "../constants/index.js";

/**
 * Notification audiences — mirrors the `NotificationAudience` enum in Prisma.
 *
 * `ALL` means "belongs to both app surfaces": legacy rows the backfill could not
 * resolve, and genuine admin broadcasts.
 */
export const NOTIFICATION_AUDIENCE = {
  CUSTOMER: "customer",
  EXPERT: "expert",
  ALL: "all",
};

const VALID = new Set(Object.values(NOTIFICATION_AUDIENCE));

/**
 * Coerce a JWT role into an audience. Anything that is not exactly `customer`
 * or `expert` (admin, or a malformed/missing role) falls back to `all`, so a bad
 * token can never produce an invalid Prisma enum value.
 *
 * @param {string|undefined|null} role
 * @returns {"customer"|"expert"|"all"}
 */
export function audienceForRole(role) {
  if (role === ROLES.CUSTOMER) return NOTIFICATION_AUDIENCE.CUSTOMER;
  if (role === ROLES.EXPERT) return NOTIFICATION_AUDIENCE.EXPERT;
  return NOTIFICATION_AUDIENCE.ALL;
}

/** True when `value` is a usable audience for a write. */
export function isAudience(value) {
  return VALID.has(value);
}

/**
 * Prisma `in` filter for every row this role is allowed to see: its own plus
 * the shared `all` bucket. A role that resolved to `all` (admin) sees everything
 * rather than nothing.
 *
 * @param {string|undefined|null} role
 */
export function audienceFilterForRole(role) {
  const audience = audienceForRole(role);
  if (audience === NOTIFICATION_AUDIENCE.ALL) {
    return { in: [NOTIFICATION_AUDIENCE.CUSTOMER, NOTIFICATION_AUDIENCE.EXPERT, NOTIFICATION_AUDIENCE.ALL] };
  }
  return { in: [audience, NOTIFICATION_AUDIENCE.ALL] };
}

/**
 * Prisma `in` filter for the notification rows that belong to `audience`,
 * including the shared `all` bucket. Use this when the audience is already
 * known (a dispatch, a badge recount); use `audienceFilterForRole` when
 * starting from a JWT role.
 *
 * @param {"customer"|"expert"|"all"} audience
 */
export function audienceRowFilter(audience) {
  if (audience === NOTIFICATION_AUDIENCE.ALL || !VALID.has(audience)) {
    return { in: [NOTIFICATION_AUDIENCE.CUSTOMER, NOTIFICATION_AUDIENCE.EXPERT, NOTIFICATION_AUDIENCE.ALL] };
  }
  return { in: [audience, NOTIFICATION_AUDIENCE.ALL] };
}

/**
 * Prisma `in` filter for the devices that should receive a push for `audience`.
 * A device still on the legacy `all` role receives both until its next login
 * re-registers the token.
 *
 * @param {"customer"|"expert"|"all"} audience
 */
export function deviceFilterForAudience(audience) {
  if (audience === NOTIFICATION_AUDIENCE.ALL || !VALID.has(audience)) {
    return { in: [NOTIFICATION_AUDIENCE.CUSTOMER, NOTIFICATION_AUDIENCE.EXPERT, NOTIFICATION_AUDIENCE.ALL] };
  }
  return { in: [audience, NOTIFICATION_AUDIENCE.ALL] };
}
