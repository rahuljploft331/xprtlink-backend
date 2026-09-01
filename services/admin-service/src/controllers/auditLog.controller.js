import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { badRequest } from "@xprtlink/shared/utils/errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max length of the flattened `payload` string surfaced as `details`. */
const DETAILS_MAX_LEN = 160;

/**
 * The admin portal's module dropdown speaks product language ("experts"),
 * while `AdminAuditLog.entityType` stores the Prisma model name
 * ("ExpertProfile"). Map the known ones so the filter actually narrows;
 * anything unmapped still falls through to a case-insensitive `contains`,
 * which keeps future entity types working without another release.
 */
const MODULE_ENTITY_TYPES = {
  customers: ["User", "CustomerProfile"],
  experts: ["ExpertProfile", "ExpertPayout"],
  verifications: ["ExpertVerification"],
  categories: ["Category"],
  admins: ["AdminUser"],
  cms: ["CmsPage"],
  reviews: ["Review"],
  notifications: ["Notification", "NotificationBlast"],
  settings: ["AdminSetting", "PlatformSetting"],
};

/**
 * Flatten an audit `payload` into a short human-readable string for the
 * "Details" column. Returns null when there is nothing worth showing —
 * the portal renders that as an em dash.
 */
function summarizePayload(payload) {
  if (payload == null) return null;
  if (typeof payload === "string") return payload.trim() || null;
  if (typeof payload !== "object") return String(payload);
  if (Array.isArray(payload)) {
    if (payload.length === 0) return null;
    return truncate(JSON.stringify(payload));
  }

  const entries = Object.entries(payload).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;

  const parts = entries.map(([key, value]) => {
    const rendered =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    return `${key}: ${rendered}`;
  });

  return truncate(parts.join(", "));
}

function truncate(str) {
  return str.length > DETAILS_MAX_LEN ? `${str.slice(0, DETAILS_MAX_LEN - 1)}…` : str;
}

/**
 * GET /api/v1/admin/audit-log
 * Read-only, super-admin-only view of the immutable admin action trail.
 * Query: page, limit, action, module, adminId (empty string = no filter).
 */
export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);

    const action = req.query.action?.trim();
    const module = req.query.module?.trim();
    const adminId = req.query.adminId?.trim();

    const where = {};

    // Stored actions are namespaced ("verification.approve"), while the portal
    // filters by bare verbs ("approve") — match on `contains`, never rename.
    if (action) where.action = { contains: action, mode: "insensitive" };

    if (adminId) {
      if (!UUID_RE.test(adminId)) {
        // Passing a non-uuid straight to Prisma raises P2023 → 500.
        return next(badRequest("adminId must be a valid UUID", "BAD_REQUEST", "adminId"));
      }
      where.actorAdminId = adminId;
    }

    if (module) {
      const mapped = MODULE_ENTITY_TYPES[module.toLowerCase()] ?? [];
      where.OR = [
        ...(mapped.length ? [{ entityType: { in: mapped } }] : []),
        { entityType: { contains: module, mode: "insensitive" } },
      ];
    }

    const [total, logs] = await Promise.all([
      db.adminAuditLog.count({ where }),
      db.adminAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          actor: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    const items = logs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      adminId: log.actorAdminId,
      adminName: log.actor?.name || log.actor?.email || "System",
      action: log.action,
      module: log.entityType,
      targetId: log.entityId,
      targetName: null,
      details: summarizePayload(log.payload),
      ipAddress: log.ipAddress,
    }));

    return ResponseFormatter.success(res, {
      message: getMessage("auditLogLoaded"),
      data: { items, page, limit, total },
    });
  } catch (err) {
    next(err);
  }
}
