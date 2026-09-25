/**
 * PM2 cron runner — release stale card holds.
 *
 * Cancels the pre-auth hold of consultations that ended without a billable call
 * (declined / never connected / abandoned) when the per-event release was missed,
 * and fails requests nobody answered. Runs once and exits.
 */
import { runInternalJob } from "@xprtlink/shared/lib/cronRunner.js";

runInternalJob({
  name: "release-holds",
  serviceUrl: process.env.BILLING_SERVICE_URL || "http://localhost:4006",
  path: "/api/v1/billing/consultations/release-holds",
});
