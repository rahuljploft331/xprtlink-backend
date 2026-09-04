import { getDb } from "@xprtlink/shared/db";
import {
  toNotificationDto,
  toNotificationPreferencesDto,
  toUnreadCountDto,
} from "@xprtlink/shared/mappers/notification.mapper.js";
import { notFound } from "@xprtlink/shared/utils/errors.js";
import { parsePagination, paginatedResult } from "@xprtlink/shared/utils/pagination.js";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@xprtlink/shared/constants/index.js";

export async function registerDeviceToken(auth, body) {
  const db = getDb();
  await db.deviceToken.upsert({
    where: {
      userId_token: {
        userId: auth.userId,
        token: body.token,
      },
    },
    create: {
      userId: auth.userId,
      token: body.token,
      platform: body.platform,
    },
    update: {
      platform: body.platform,
      lastSeenAt: new Date(),
    },
  });
  return { registered: true };
}

export async function listNotifications(auth, query) {
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();

  const [rows, total] = await Promise.all([
    db.notification.findMany({
      where: { userId: auth.userId, clearedAt: null },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.notification.count({ where: { userId: auth.userId, clearedAt: null } }),
  ]);

  const items = rows.map(toNotificationDto);
  return paginatedResult(items, { page, limit, total });
}

export async function getUnreadCount(auth) {
  const count = await getDb().notification.count({
    where: { userId: auth.userId, readAt: null, clearedAt: null },
  });
  return toUnreadCountDto(count);
}

export async function markNotificationRead(auth, notificationId) {
  const db = getDb();
  const notification = await db.notification.findFirst({
    where: { id: notificationId, userId: auth.userId, clearedAt: null },
  });
  if (!notification) throw notFound("Notification not found");

  if (notification.readAt) {
    return toNotificationDto(notification);
  }

  const updated = await db.notification.update({
    where: { id: notification.id },
    data: { readAt: new Date() },
  });

  return toNotificationDto(updated);
}

export async function markAllRead(auth) {
  const result = await getDb().notification.updateMany({
    where: { userId: auth.userId, readAt: null, clearedAt: null },
    data: { readAt: new Date() },
  });
  return { marked: result.count };
}

/**
 * Soft-delete a single notification for the current user.
 * Rows are never removed — `clearedAt` is stamped so every read path filters it out.
 * Scoped by userId, so a user cannot clear someone else's notification (404 instead).
 * Idempotent: an already-cleared notification returns success without re-writing.
 */
export async function clearNotification(auth, notificationId) {
  const db = getDb();
  const notification = await db.notification.findFirst({
    where: { id: notificationId, userId: auth.userId },
  });
  if (!notification) throw notFound("Notification not found");

  if (notification.clearedAt) {
    return { cleared: true };
  }

  await db.notification.update({
    where: { id: notification.id },
    data: { clearedAt: new Date() },
  });

  return { cleared: true };
}

/**
 * Soft-delete every notification for the current user.
 * Non-destructive — history is retained, rows are just hidden from all read paths.
 */
export async function clearAllNotifications(auth) {
  const result = await getDb().notification.updateMany({
    where: { userId: auth.userId, clearedAt: null },
    data: { clearedAt: new Date() },
  });
  return { cleared: result.count };
}

async function getOrCreatePreferences(userId, role) {
  const db = getDb();
  let pref = await db.notificationPreference.findUnique({ where: { userId } });
  if (!pref) {
    const defaults = DEFAULT_NOTIFICATION_PREFERENCES[role] ?? {};
    pref = await db.notificationPreference.create({
      data: { userId, preferences: defaults },
    });
  }
  return pref;
}

export async function getPreferences(auth) {
  const pref = await getOrCreatePreferences(auth.userId, auth.role);
  return toNotificationPreferencesDto(pref);
}

export async function updatePreferences(auth, body) {
  const db = getDb();
  const existing = await getOrCreatePreferences(auth.userId, auth.role);
  const merged = { ...(existing.preferences ?? {}), ...body.preferences };

  const pref = await db.notificationPreference.update({
    where: { userId: auth.userId },
    data: { preferences: merged },
  });

  return toNotificationPreferencesDto(pref);
}

/**
 * Internal dispatch — create in-app notification records for a list of users.
 * Called by other microservices via POST /api/v1/notifications/dispatch.
 * Does NOT send push notifications yet (FCM/APNs integration is a future task).
 *
 * @param {{ userIds: string[], title: string, body: string, data?: object }} payload
 */
export async function dispatchNotification({ userIds, type, title, body: bodyText, data = {} }) {
  if (!Array.isArray(userIds) || userIds.length === 0) return { dispatched: 0 };

  // `type` is required by the model and has no default. Callers may send it at the
  // top level, or nested in `data` (the original zego caller does); fall back to a
  // generic type rather than throwing, so a mislabelled notification still lands.
  const resolvedType = String(type ?? data?.type ?? "system").slice(0, 64);

  const db = getDb();
  
  // Load preferences for these users
  const prefs = await db.notificationPreference.findMany({
    where: { userId: { in: userIds } },
  });
  
  const prefsMap = new Map(prefs.map((p) => [p.userId, p.preferences]));

  const filteredUserIds = userIds.filter((userId) => {
    const userPrefs = prefsMap.get(userId) ?? {};
    // Default to true if the preference is undefined
    const optIn = userPrefs[resolvedType] ?? true;
    return optIn === true;
  });

  if (filteredUserIds.length === 0) return { dispatched: 0 };

  const created = await db.notification.createMany({
    // NOTE: the column is `payload`, not `data`. The wire contract keeps the name
    // `data` for callers; it is mapped here.
    data: filteredUserIds.map((userId) => ({
      userId,
      type: resolvedType,
      title: title ?? "Notification",
      body: bodyText ?? "",
      payload: data ?? {},
    })),
    skipDuplicates: true,
  });

  return { dispatched: created.count };
}
