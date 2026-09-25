/**
 * PM2 cron runner — re-attempt failed expert payouts.
 *
 * Invoked by PM2 `cron_restart` (see ecosystem.config.cjs). Runs once and exits.
 * Retries the Stripe transfer for any ExpertPayout left in `failed` status by a
 * prior payout run. Safe to run repeatedly — the transfer is idempotent per payout.
 */
import { runInternalJob } from "@xprtlink/shared/lib/cronRunner.js";

runInternalJob({
  name: "retry-payouts",
  serviceUrl: process.env.BILLING_SERVICE_URL || "http://localhost:4006",
  path: "/api/v1/billing/payouts/retry-failed",
});
