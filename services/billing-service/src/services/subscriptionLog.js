import { logger } from "@xprtlink/shared/lib/logger.js";

const log = logger.child({ module: "subscription" });

/**
 * One plain-English line per subscription event, e.g.
 *   SUBSCRIPTION SUBSCRIBED — apple, plan=elite, expert=7599cba9, Bought a new subscription
 * Grep the logs for "SUBSCRIPTION " to follow the whole journey.
 * Events: SUBSCRIBED | RENEWED | CANCELLED (auto-renew off) | EXPIRED | REVOKED | PAYMENT_FAILED | BLOCKED
 */
export function logSubscriptionEvent(event, { store, plan, expertProfileId, note } = {}) {
  const parts = [store, plan && `plan=${plan}`, expertProfileId && `expert=${String(expertProfileId).slice(0, 8)}`, note].filter(Boolean);
  log.info(`SUBSCRIPTION ${event} — ${parts.join(", ")}`);
}
