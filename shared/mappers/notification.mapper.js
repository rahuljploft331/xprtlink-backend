import { toIso } from "./common.js";

export function toNotificationDto(notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    payload: notification.payload ?? {},
    readAt: toIso(notification.readAt),
    createdAt: toIso(notification.createdAt),
  };
}

export function toUnreadCountDto(count) {
  return { count };
}

export function toNotificationPreferencesDto(pref) {
  return {
    preferences: pref?.preferences ?? {},
  };
}
