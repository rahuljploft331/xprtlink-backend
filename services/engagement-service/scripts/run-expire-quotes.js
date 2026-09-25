/**
 * PM2 cron runner — expire stale quotes.
 *
 * Wires the previously-orphaned POST /engagement/quotes/expire endpoint into the
 * scheduler. Runs once and exits.
 */
import { runInternalJob } from "@xprtlink/shared/lib/cronRunner.js";

runInternalJob({
  name: "expire-quotes",
  serviceUrl: process.env.ENGAGEMENT_SERVICE_URL || "http://localhost:4004",
  path: "/api/v1/engagement/quotes/expire",
});
