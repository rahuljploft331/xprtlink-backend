/**
 * PM2 cron runner — expire subscriptions past their period end.
 *
 * Wires the previously-orphaned POST /billing/subscriptions/expire endpoint into
 * the scheduler. Runs once and exits.
 */
import { runInternalJob } from "@xprtlink/shared/lib/cronRunner.js";

runInternalJob({
  name: "expire-subscriptions",
  serviceUrl: process.env.BILLING_SERVICE_URL || "http://localhost:4006",
  path: "/api/v1/billing/subscriptions/expire",
});
