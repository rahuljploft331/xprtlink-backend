/**
 * PM2 cron runner — retry failed consultation captures.
 *
 * Invoked by PM2 `cron_restart` (see ecosystem.config.cjs). Runs once and exits.
 * All logic lives in billing-service behind POST /consultations/retry-captures;
 * this shim just makes the authenticated internal call so the job is also
 * testable over HTTP.
 */
import { runInternalJob } from "@xprtlink/shared/lib/cronRunner.js";

runInternalJob({
  name: "retry-captures",
  serviceUrl: process.env.BILLING_SERVICE_URL || "http://localhost:4006",
  path: "/api/v1/billing/consultations/retry-captures",
});
