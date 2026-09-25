import { getDb } from "@xprtlink/shared/db";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "expireQuotes" });

/**
 * Expire stale quotes that have been in "pending_expert_review" for longer than
 * the configured TTL (default: 7 days). Called on a schedule (e.g., every 15 min).
 *
 * This function is idempotent and safe to call concurrently.
 */
const QUOTE_EXPIRY_DAYS = Number(process.env.QUOTE_EXPIRY_DAYS || 7);

export async function expireStaleQuotes() {
  const db = getDb();
  const cutoff = new Date(Date.now() - QUOTE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const expiredQuotes = await db.quoteRequest.findMany({
    where: {
      status: { in: ["submitted", "pending_expert_review"] },
      updatedAt: { lt: cutoff },
    },
    select: { id: true, customerId: true, expertId: true },
  });

  if (expiredQuotes.length > 0) {
    const expiredIds = expiredQuotes.map((q) => q.id);
    await db.quoteRequest.updateMany({
      where: { id: { in: expiredIds } },
      data: { status: "expired" },
    });

    log.info(`[cron] Expired ${expiredQuotes.length} stale quote(s) older than ${QUOTE_EXPIRY_DAYS} days`);

    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const customerIds = [...new Set(expiredQuotes.map((q) => q.customerId))];
    const expertIds = [...new Set(expiredQuotes.map((q) => q.expertId))];

    if (customerIds.length > 0) {
      internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: customerIds,
        type: "quote_expired",
        title: "Quote Expired",
        body: getMessage("quoteExpiredCustomer"),
        data: {},
      }).catch((err) => log.error({ err: err.message }, "[cron] Failed to notify customers:"));
    }

    if (expertIds.length > 0) {
      internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: expertIds,
        type: "quote_expired",
        title: "Quote Expired",
        body: getMessage("quoteExpiredExpert"),
        data: {},
      }).catch((err) => log.error({ err: err.message }, "[cron] Failed to notify experts:"));
    }
  }

  return { expired: expiredQuotes.length };
}
