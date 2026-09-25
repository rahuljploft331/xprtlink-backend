/**
 * PM2 cron runner — expire subscriptions past their period end.
 *
 * Wires the previously-orphaned POST /billing/subscriptions/expire endpoint into
 * the scheduler. Runs once and exits.
 */
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";

const BILLING_URL = process.env.BILLING_SERVICE_URL || "http://localhost:4006";

(async () => {
  try {
    const data = await internalPost(BILLING_URL, "/api/v1/billing/subscriptions/expire", {});
    console.log(`[cron:expire-subscriptions] ${new Date().toISOString()} →`, JSON.stringify(data));
    process.exit(0);
  } catch (err) {
    console.error(`[cron:expire-subscriptions] failed: ${err.message}`);
    process.exit(1);
  }
})();
