/**
 * PM2 cron runner — retry failed consultation captures.
 *
 * Invoked by PM2 `cron_restart` (see ecosystem.config.cjs). Runs once and exits.
 * All logic lives in billing-service behind POST /consultations/retry-captures;
 * this shim just makes the authenticated internal call so the job is also
 * testable over HTTP.
 */
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";

const BILLING_URL = process.env.BILLING_SERVICE_URL || "http://localhost:4006";

(async () => {
  try {
    const data = await internalPost(BILLING_URL, "/api/v1/billing/consultations/retry-captures", {});
    console.log(`[cron:retry-captures] ${new Date().toISOString()} →`, JSON.stringify(data));
    process.exit(0);
  } catch (err) {
    console.error(`[cron:retry-captures] failed: ${err.message}`);
    process.exit(1);
  }
})();
