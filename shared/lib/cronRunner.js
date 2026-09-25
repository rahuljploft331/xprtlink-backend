/**
 * Shared body of the PM2 cron runner scripts (services/<svc>/scripts/run-*.js).
 *
 * PM2 launches every `cron_restart` app once immediately on `pm2 start` /
 * deploy — usually before the target service is listening, which used to log a
 * spurious "fetch failed". Wait for the service's /health first, then make the
 * authenticated internal call, log the result, and exit.
 */
import { internalPost } from "./internalFetch.js";

const HEALTH_WAIT_MS = Number(process.env.CRON_HEALTH_WAIT_MS || 60_000);
const HEALTH_POLL_MS = 2_000;

async function waitForHealth(serviceUrl) {
  const deadline = Date.now() + HEALTH_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${serviceUrl}/health`);
      if (res.ok) return;
    } catch {
      // Not listening yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  throw new Error(`${serviceUrl} not healthy after ${HEALTH_WAIT_MS}ms`);
}

export async function runInternalJob({ name, serviceUrl, path, body = {} }) {
  try {
    await waitForHealth(serviceUrl);
    const data = await internalPost(serviceUrl, path, body);
    console.log(`[cron:${name}] ${new Date().toISOString()} →`, JSON.stringify(data));
    process.exit(0);
  } catch (err) {
    console.error(`[cron:${name}] failed: ${err.message}`);
    process.exit(1);
  }
}
