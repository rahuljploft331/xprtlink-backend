/**
 * PM2 cron runner — run the payout job.
 *
 * Invoked by PM2 `cron_restart` (see ecosystem.config.cjs). Runs once and exits.
 * The window it settles is derived from the admin-configured `payoutSchedule`
 * (integer days) inside billing-service; this shim just triggers the run.
 */
import { runInternalJob } from "@xprtlink/shared/lib/cronRunner.js";

runInternalJob({
  name: "payouts",
  serviceUrl: process.env.BILLING_SERVICE_URL || "http://localhost:4006",
  path: "/api/v1/billing/payouts/run",
});
