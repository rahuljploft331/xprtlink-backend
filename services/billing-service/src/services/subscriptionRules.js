/**
 * Single source of truth for subscription plan hierarchy and purchase rules.
 * Pure functions only (no DB / store calls) so every path — eligibility,
 * Apple/Google verify, plan listing — applies identical rules.
 */

/** Ascending order: index 0 is the lowest tier. */
export const PLAN_TIER_ORDER = ["core", "professional", "elite"];

/** Statuses that still carry paid entitlement (matches getMySubscription / eligibility). */
export const ENTITLED_STATUSES = ["active", "grace_period", "on_hold"];

export const PLAN_CHANGE = Object.freeze({
  NEW: "new",
  UPGRADE: "upgrade",
  SAME: "same",
  DOWNGRADE: "downgrade",
  UNKNOWN: "unknown",
});

export const SUBSCRIPTION_ERROR = Object.freeze({
  DOWNGRADE_BLOCKED: "SUBSCRIPTION_DOWNGRADE_BLOCKED",
  ALREADY_ACTIVE: "SUBSCRIPTION_ALREADY_ACTIVE",
  // The account has a live website (Stripe) subscription: it is changed/cancelled on the website, never by an in-app purchase.
  MANAGED_ON_WEB: "SUBSCRIPTION_MANAGED_ON_WEB",
  // Kept as-is: already emitted by the verify endpoints before this change.
  ALREADY_LINKED: "SUBSCRIPTION_ALREADY_LINKED",
  STORE_VERIFICATION_FAILED: "STORE_VERIFICATION_FAILED",
});

/** 1-based tier of a plan code, or null when the code is not in the hierarchy. */
export function planTier(code) {
  const i = PLAN_TIER_ORDER.indexOf(String(code ?? "").trim().toLowerCase());
  return i === -1 ? null : i + 1;
}

/** How moving from `currentCode` to `requestedCode` should be classified. */
export function comparePlans(currentCode, requestedCode) {
  if (!currentCode) return PLAN_CHANGE.NEW;
  const cur = planTier(currentCode);
  const req = planTier(requestedCode);
  if (cur === null || req === null) return PLAN_CHANGE.UNKNOWN;
  if (req > cur) return PLAN_CHANGE.UPGRADE;
  if (req === cur) return PLAN_CHANGE.SAME;
  return PLAN_CHANGE.DOWNGRADE;
}

/**
 * Decide whether a purchase of `requestedCode` may start while `currentCode`
 * is an entitled subscription. Unknown codes fail open (no tier info to judge)
 * so custom plans keep working; the caller logs it.
 */
export function evaluatePlanChange(currentCode, requestedCode) {
  const relation = comparePlans(currentCode, requestedCode);
  switch (relation) {
    case PLAN_CHANGE.DOWNGRADE:
      return { allowed: false, relation, code: SUBSCRIPTION_ERROR.DOWNGRADE_BLOCKED, messageKey: "subscriptionDowngradeBlocked" };
    case PLAN_CHANGE.SAME:
      return { allowed: false, relation, code: SUBSCRIPTION_ERROR.ALREADY_ACTIVE, messageKey: "subscriptionAlreadyActive" };
    default:
      return { allowed: true, relation, code: null, messageKey: null };
  }
}

/** True when the row still entitles its owner to paid access at `now`. */
export function hasActiveEntitlement(sub, now = new Date()) {
  if (!sub || !ENTITLED_STATUSES.includes(sub.status)) return false;
  const end = Math.max(
    sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : 0,
    sub.status === "grace_period" && sub.gracePeriodEnd ? new Date(sub.gracePeriodEnd).getTime() : 0,
  );
  return end > now.getTime();
}
