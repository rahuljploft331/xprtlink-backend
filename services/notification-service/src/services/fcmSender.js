/**
 * FCM push sender using firebase-admin (FCM HTTP v1 API).
 *
 * Initialised lazily on first call so the service can still start
 * when SERVICE_ACCOUNT_JSON is missing (dev without Firebase).
 *
 * Env vars required in production:
 *   SERVICE_ACCOUNT_JSON  — full service-account JSON string
 *   FIREBASE_PROJECT_ID            — e.g. "xprtlink-2026"
 */

import admin from "firebase-admin";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "fcmSender" });

let app = null;

function getApp() {
  if (app) return app;

  const raw = process.env.SERVICE_ACCOUNT_JSON;
  if (!raw) {
    log.warn("[fcmSender] SERVICE_ACCOUNT_JSON not set — push disabled");
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    log.info("[fcmSender] Firebase Admin initialised for project:", serviceAccount.project_id);
    return app;
  } catch (err) {
    log.error({ err: err.message }, "[fcmSender] Failed to initialise Firebase Admin:");
    return null;
  }
}

/**
 * Send a single FCM push to one device token.
 * Returns true on success, false on any error (never throws — push is non-fatal).
 *
 * @param {string} token  - FCM device token
 * @param {string} title  - Notification title
 * @param {string} body   - Notification body
 * @param {object} data   - Optional key-value data payload (strings only)
 * @param {number} badge  - iOS app-icon badge (user's unread notification count)
 */
export async function sendPushToToken(token, title, body, data = {}, badge = 1) {
  const firebaseApp = getApp();
  if (!firebaseApp) return { ok: false, isStale: false };

  // FCM data payloads require all values to be strings
  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = typeof v === "string" ? v : JSON.stringify(v);
  }

  const message = {
    token,
    notification: { title, body },
    data: stringData,
    android: {
      priority: "high",
      notification: {
        sound: "default",
        click_action: "FLUTTER_NOTIFICATION_CLICK",
        tag: stringData.messageId || stringData.quoteId || stringData.consultationId || stringData.type || "xprtlink",
      },
    },
    apns: {
      payload: {
        aps: { sound: "default", badge },
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    log.info(`[fcmSender] Push sent → ${response}`);
    return { ok: true, isStale: false };
  } catch (err) {
    log.warn(`[fcmSender] Push failed for token ${token.slice(0, 20)}…: ${err.message}`);
    const isStale = err.code === 'messaging/invalid-registration-token' || err.code === 'messaging/registration-token-not-registered';
    return { ok: false, isStale };
  }
}

/**
 * Send FCM push to all device tokens belonging to a list of userIds.
 * Fetches tokens from DB, fires sends concurrently, cleans up dead tokens.
 *
 * @param {import('@prisma/client').PrismaClient} db
 * @param {string[]} userIds
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
export async function sendPushToUsers(db, userIds, title, body, data = {}) {
  if (!userIds?.length) return;

  const firebaseApp = getApp();
  if (!firebaseApp) return;

  const tokens = await db.deviceToken.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, token: true, userId: true },
  });

  if (!tokens.length) return;

  // Deduplicate by token string — a single physical device should only
  // receive one push even if stale rows exist for the same token.
  const seen = new Set();
  const unique = tokens.filter(({ token }) => {
    if (seen.has(token)) return false;
    seen.add(token);
    return true;
  });

  // Badge = the user's unread count, same as the bell icon.
  const counts = await db.notification.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, readAt: null, clearedAt: null },
    _count: { _all: true },
  });
  const badgeByUser = new Map(counts.map((c) => [c.userId, c._count._all]));

  const results = await Promise.all(
    unique.map(async ({ id, token, userId }) => {
      const res = await sendPushToToken(token, title, body, data, badgeByUser.get(userId) ?? 0);
      return { id, isStale: res.isStale };
    })
  );

  // Prune stale tokens that permanently failed
  const deadIds = results.filter((r) => r.isStale).map((r) => r.id);
  if (deadIds.length) {
    await db.deviceToken.deleteMany({ where: { id: { in: deadIds } } }).catch(() => {});
    log.info(`[fcmSender] Pruned ${deadIds.length} stale device token(s)`);
  }
}

/**
 * Send a silent push to all of a user's iOS devices to set the badge to their
 * current unread notification count (matches the bell icon).
 * @param {import('@prisma/client').PrismaClient} db
 * @param {string} userId
 */
export async function syncBadgeForUser(db, userId) {
  const count = await db.notification.count({
    where: { userId, readAt: null, clearedAt: null },
  });
  return setBadgeForUser(db, userId, count);
}

/**
 * Send a silent push to all of a user's iOS devices to reset the badge to 0.
 * @param {import('@prisma/client').PrismaClient} db
 * @param {string} userId
 */
export function resetBadgeForUser(db, userId) {
  return setBadgeForUser(db, userId, 0);
}

async function setBadgeForUser(db, userId, badge) {
  const firebaseApp = getApp();
  if (!firebaseApp) return;

  const tokens = await db.deviceToken.findMany({
    where: { userId },
    select: { token: true },
  });

  if (!tokens.length) return;

  await Promise.all(
    tokens.map(async ({ token }) => {
      try {
        await admin.messaging().send({
          token,
          apns: {
            payload: { aps: { "content-available": 1, badge } },
          },
        });
      } catch (err) {
        // Token may be dead — non-fatal
        log.warn(`[fcmSender] Badge reset failed for token ${token.slice(0, 20)}…: ${err.message}`);
      }
    })
  );
}
