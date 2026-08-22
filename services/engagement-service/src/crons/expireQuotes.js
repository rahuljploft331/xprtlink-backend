import { getDb } from "@xprtlink/shared/db";

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

  const result = await db.quoteRequest.updateMany({
    where: {
      status: { in: ["submitted", "pending_expert_review"] },
      updatedAt: { lt: cutoff },
    },
    data: { status: "expired" },
  });

  if (result.count > 0) {
    console.log(`[cron] Expired ${result.count} stale quote(s) older than ${QUOTE_EXPIRY_DAYS} days`);
  }

  return { expired: result.count };
}
