import { toIso } from "./common.js";

/**
 * In-app notification DTO — single source of truth for the mobile clients.
 *
 * Contract (no legacy aliases, single-direction):
 * - `isRead`  boolean   canonical read flag, derived from `readAt`
 * - `readAt`  ISO|null  timestamp the row was read (null when unread)
 * - `data`    object    routing payload (quoteId / conversationId / etc.)
 *
 * The DB column is `payload`; it is exposed to clients as `data`.
 */
export function toNotificationDto(notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: notification.payload ?? {},
    isRead: notification.readAt != null,
    readAt: toIso(notification.readAt),
    createdAt: toIso(notification.createdAt),
  };
}

export function toUnreadCountDto(count) {
  return { count };
}

import { DEFAULT_NOTIFICATION_PREFERENCES } from "../constants/index.js";

export function toNotificationPreferencesDto(pref, role) {
  return {
    preferences: pref?.preferences ?? {},
    meta: {
      defaultPreferences: DEFAULT_NOTIFICATION_PREFERENCES[role] ?? {},
    },
  };
}
