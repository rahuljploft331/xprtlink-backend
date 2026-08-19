import { auditLogs } from "@xprtlink/shared/db/repositories/admin/index.js";

/**
 * Record a sensitive admin action to the audit log.
 * Fire-and-forget by design — a logging failure must never block the response,
 * so callers should await this (to flush before the handler returns) but any
 * DB error is swallowed here rather than propagated to next().
 */
export async function logAdminAction(req, action, entityType, entityId, payload = {}) {
  try {
    await auditLogs().create({
      data: {
        actorAdminId: req.adminUser.id,
        action,
        entityType,
        entityId: entityId != null ? String(entityId) : null,
        payload,
        ipAddress: req.ip,
      },
    });
  } catch (err) {
    console.error("Failed to write admin audit log:", err);
  }
}
