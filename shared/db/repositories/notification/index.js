import { getDb } from "../../getClient.js";

export function notifications() {
  return getDb().notification;
}

export function preferences() {
  return getDb().notificationPreference;
}
