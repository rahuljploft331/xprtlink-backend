import { getDb } from "../../getClient.js";

export function adminUsers() {
  return getDb().adminUser;
}

export function permissions() {
  return getDb().adminPermission;
}

export function auditLogs() {
  return getDb().adminAuditLog;
}
