/**
 * PM2 cron runner — expire stale quotes.
 *
 * Wires the previously-orphaned POST /engagement/quotes/expire endpoint into the
 * scheduler. Runs once and exits.
 */
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";

const ENGAGEMENT_URL = process.env.ENGAGEMENT_SERVICE_URL || "http://localhost:4004";

(async () => {
  try {
    const data = await internalPost(ENGAGEMENT_URL, "/api/v1/engagement/quotes/expire", {});
    console.log(`[cron:expire-quotes] ${new Date().toISOString()} →`, JSON.stringify(data));
    process.exit(0);
  } catch (err) {
    console.error(`[cron:expire-quotes] failed: ${err.message}`);
    process.exit(1);
  }
})();
