/**
 * PM2 cron runner — re-attempt failed expert payouts.
 *
 * Invoked by PM2 `cron_restart` (see ecosystem.config.cjs). Runs once and exits.
 * Retries the Stripe transfer for any ExpertPayout left in `failed` status by a
 * prior payout run. Safe to run repeatedly — the transfer is idempotent per payout.
 */
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";

const BILLING_URL = process.env.BILLING_SERVICE_URL || "http://localhost:4006";

(async () => {
  try {
    const data = await internalPost(BILLING_URL, "/api/v1/billing/payouts/retry-failed", {});
    console.log(`[cron:retry-payouts] ${new Date().toISOString()} →`, JSON.stringify(data));
    process.exit(0);
  } catch (err) {
    console.error(`[cron:retry-payouts] failed: ${err.message}`);
    process.exit(1);
  }
})();
