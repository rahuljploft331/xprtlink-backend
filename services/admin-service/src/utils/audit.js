import { auditLogs } from "@xprtlink/shared/db/repositories/admin/index.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "audit" });

/**
 * Record a sensitive admin action to the audit log.
 * Fire-and-forget by design — a logging failure must never block the response,
 * so callers should await this (to flush before the handler returns) but any
 * DB error is swallowed here rather than propagated to next().
 */
export async function logAdminAction(req, action, entityType, entityId, payload = {}) {
  try {
    // Callers often spread partial request bodies (e.g. { name, status } from
    // a PATCH where only one field was sent) straight into payload — strip
    // undefined values so the Json column always gets a clean object.
    const cleanPayload = JSON.parse(JSON.stringify(payload ?? {}));

    await auditLogs().create({
      data: {
        actorAdminId: req.adminUser.id,
        action,
        entityType,
        entityId: entityId != null ? String(entityId) : null,
        payload: cleanPayload,
        ipAddress: req.ip,
      },
    });
  } catch (err) {
    log.error({ err: err }, "Failed to write admin audit log:");
  }
}
