/**
 * PM2 cron runner — run the payout job.
 *
 * Invoked by PM2 `cron_restart` (see ecosystem.config.cjs). Runs once and exits.
 * The window it settles is derived from the admin-configured `payoutSchedule`
 * (integer days) inside billing-service; this shim just triggers the run.
 */
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";

const BILLING_URL = process.env.BILLING_SERVICE_URL || "http://localhost:4006";

(async () => {
  try {
    const data = await internalPost(BILLING_URL, "/api/v1/billing/payouts/run", {});
    console.log(`[cron:payouts] ${new Date().toISOString()} →`, JSON.stringify(data));
    process.exit(0);
  } catch (err) {
    console.error(`[cron:payouts] failed: ${err.message}`);
    process.exit(1);
  }
})();
