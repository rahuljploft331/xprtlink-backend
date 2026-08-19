/**
 * SSE Poller — polls the shared PostgreSQL DB every POLL_INTERVAL ms
 * to detect new domain events and broadcast them to connected admin SSE clients.
 *
 * Why polling instead of DB triggers / LISTEN-NOTIFY?
 *   - Zero extra infrastructure (no separate PG connection for LISTEN)
 *   - Works identically in local dev, staging, and production
 *   - Admin SSE is low-volume: only relevant when admins are active
 *   - POLL_INTERVAL is short enough (5 s) for acceptable UX latency
 *
 * Events polled:
 *   ticket:created          – new SupportTicket rows
 *   verification:submitted  – new ExpertVerification rows
 *   report:filed            – new ExpertReport rows
 *   consultation:completed  – Consultation rows that just moved to completed
 *   user:registered         – new User rows (any role)
 *   review:flagged          – Review rows with status = flagged
 */

import { getDb } from "@xprtlink/shared/db";
import { publish } from "./sseHub.js";

const POLL_INTERVAL = 5_000; // 5 seconds

// Track the last-seen timestamp per domain so we don't re-broadcast old rows
const cursors = {
  ticketCreated: new Date(),
  verificationSubmitted: new Date(),
  reportFiled: new Date(),
  consultationCompleted: new Date(),
  userRegistered: new Date(),
  reviewFlagged: new Date(),
};

let pollTimer = null;

async function poll() {
  const db = getDb();
  const now = new Date();

  try {
    // ── 1. Support tickets ──────────────────────────────────────────────────
    const newTickets = await db.supportTicket.findMany({
      where: { createdAt: { gt: cursors.ticketCreated } },
      orderBy: { createdAt: "asc" },
      select: { id: true, subject: true, category: true, userId: true, createdAt: true },
    });
    for (const t of newTickets) {
      publish("ticket:created", {
        id: t.id,
        subject: t.subject,
        category: t.category,
        userId: t.userId,
        createdAt: t.createdAt.toISOString(),
      });
    }
    if (newTickets.length > 0) {
      cursors.ticketCreated = newTickets.at(-1).createdAt;
    }

    // ── 2. Expert verifications ─────────────────────────────────────────────
    const newVerifications = await db.expertVerification.findMany({
      where: { submittedAt: { gt: cursors.verificationSubmitted } },
      orderBy: { submittedAt: "asc" },
      select: {
        id: true,
        expertProfileId: true,
        submittedAt: true,
        expert: { select: { firstName: true, lastName: true } },
      },
    });
    for (const v of newVerifications) {
      publish("verification:submitted", {
        id: v.id,
        expertId: v.expertProfileId,
        expertName: `${v.expert.firstName} ${v.expert.lastName}`,
        submittedAt: v.submittedAt.toISOString(),
      });
    }
    if (newVerifications.length > 0) {
      cursors.verificationSubmitted = newVerifications.at(-1).submittedAt;
    }

    // ── 3. Expert reports ───────────────────────────────────────────────────
    const newReports = await db.expertReport.findMany({
      where: { createdAt: { gt: cursors.reportFiled } },
      orderBy: { createdAt: "asc" },
      select: { id: true, expertId: true, customerId: true, reason: true, createdAt: true },
    });
    for (const r of newReports) {
      publish("report:filed", {
        id: r.id,
        expertId: r.expertId,
        customerId: r.customerId,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      });
    }
    if (newReports.length > 0) {
      cursors.reportFiled = newReports.at(-1).createdAt;
    }

    // ── 4. Completed consultations ──────────────────────────────────────────
    const newCompleted = await db.consultation.findMany({
      where: {
        status: "completed",
        endedAt: { gt: cursors.consultationCompleted },
      },
      orderBy: { endedAt: "asc" },
      select: {
        id: true,
        expertId: true,
        customerId: true,
        durationSeconds: true,
        billingStatus: true,
        endedAt: true,
      },
    });
    for (const c of newCompleted) {
      publish("consultation:completed", {
        id: c.id,
        expertId: c.expertId,
        customerId: c.customerId,
        durationSeconds: c.durationSeconds,
        billingStatus: c.billingStatus,
        endedAt: c.endedAt?.toISOString(),
      });
    }
    if (newCompleted.length > 0) {
      cursors.consultationCompleted = newCompleted.at(-1).endedAt ?? now;
    }

    // ── 5. New user registrations ───────────────────────────────────────────
    const newUsers = await db.user.findMany({
      where: { createdAt: { gt: cursors.userRegistered } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        createdAt: true,
        customerProfile: { select: { id: true } },
        expertProfile: { select: { id: true } },
      },
    });
    for (const u of newUsers) {
      const role = u.expertProfile ? "expert" : u.customerProfile ? "customer" : "unknown";
      publish("user:registered", {
        id: u.id,
        role,
        email: u.email,
        createdAt: u.createdAt.toISOString(),
      });
    }
    if (newUsers.length > 0) {
      cursors.userRegistered = newUsers.at(-1).createdAt;
    }

    // ── 6. Flagged reviews ──────────────────────────────────────────────────
    const newFlagged = await db.review.findMany({
      where: {
        status: "flagged",
        updatedAt: { gt: cursors.reviewFlagged },
      },
      orderBy: { updatedAt: "asc" },
      select: {
        id: true,
        expertId: true,
        customerId: true,
        rating: true,
        updatedAt: true,
      },
    });
    for (const r of newFlagged) {
      publish("review:flagged", {
        id: r.id,
        expertId: r.expertId,
        customerId: r.customerId,
        rating: r.rating,
        flaggedAt: r.updatedAt.toISOString(),
      });
    }
    if (newFlagged.length > 0) {
      cursors.reviewFlagged = newFlagged.at(-1).updatedAt;
    }

  } catch (err) {
    // Log but never crash — poller must survive transient DB issues
    console.error("[SSE Poller] poll error:", err.message);
  }
}

/**
 * Start the background polling loop. Call once at admin-service startup.
 * Safe to call multiple times — will not create duplicate timers.
 */
export function startPoller() {
  if (pollTimer) return; // already running
  console.log("[SSE Poller] started — poll interval:", POLL_INTERVAL, "ms");
  pollTimer = setInterval(poll, POLL_INTERVAL);
}

/**
 * Stop the polling loop (e.g. graceful shutdown).
 */
export function stopPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("[SSE Poller] stopped");
  }
}
