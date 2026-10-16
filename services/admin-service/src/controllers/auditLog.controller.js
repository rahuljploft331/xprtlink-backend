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

async function resolveTargetNames(db, logs) {
  const targetMap = new Map();

  const grouped = {};
  for (const log of logs) {
    if (!log.entityId) continue;
    if (log.entityId.toLowerCase() === "batch") {
      targetMap.set(`${log.entityType}:batch`, "Batch Operation");
      continue;
    }
    if (!UUID_RE.test(log.entityId)) continue;
    if (!grouped[log.entityType]) grouped[log.entityType] = new Set();
    grouped[log.entityType].add(log.entityId);
  }

  const queries = [];

  if (grouped.CmsPage?.size) {
    const ids = Array.from(grouped.CmsPage);
    queries.push(
      db.cmsPage.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, slug: true },
      }).then((rows) => {
        for (const r of rows) {
          targetMap.set(`CmsPage:${r.id}`, r.title || (r.slug ? `/${r.slug}` : "CMS Page"));
        }
      }).catch(() => {})
    );
  }

  if (grouped.Category?.size) {
    const ids = Array.from(grouped.Category);
    queries.push(
      db.category.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, slug: true },
      }).then((rows) => {
        for (const r of rows) {
          targetMap.set(`Category:${r.id}`, r.name || r.slug || "Category");
        }
      }).catch(() => {})
    );
  }

  if (grouped.ExpertProfile?.size) {
    const ids = Array.from(grouped.ExpertProfile);
    queries.push(
      db.expertProfile.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true },
      }).then((rows) => {
        for (const r of rows) {
          const name = [r.firstName, r.lastName].filter(Boolean).join(" ");
          targetMap.set(`ExpertProfile:${r.id}`, name || "Expert Profile");
        }
      }).catch(() => {})
    );
  }

  if (grouped.ExpertVerification?.size) {
    const ids = Array.from(grouped.ExpertVerification);
    queries.push(
      db.expertVerification.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          expert: { select: { firstName: true, lastName: true } },
        },
      }).then((rows) => {
        for (const r of rows) {
          const name = r.expert ? [r.expert.firstName, r.expert.lastName].filter(Boolean).join(" ") : null;
          targetMap.set(`ExpertVerification:${r.id}`, name ? `${name} (Verification)` : "Verification");
        }
      }).catch(() => {})
    );
  }

  if (grouped.AdminUser?.size) {
    const ids = Array.from(grouped.AdminUser);
    queries.push(
      db.adminUser.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      }).then((rows) => {
        for (const r of rows) {
          targetMap.set(`AdminUser:${r.id}`, r.name || r.email || "Admin User");
        }
      }).catch(() => {})
    );
  }

  if (grouped.CustomerProfile?.size) {
    const ids = Array.from(grouped.CustomerProfile);
    queries.push(
      db.customerProfile.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true },
      }).then((rows) => {
        for (const r of rows) {
          const name = [r.firstName, r.lastName].filter(Boolean).join(" ");
          targetMap.set(`CustomerProfile:${r.id}`, name || "Customer");
        }
      }).catch(() => {})
    );
  }

  if (grouped.User?.size) {
    const ids = Array.from(grouped.User);
    queries.push(
      db.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          email: true,
          customerProfile: { select: { firstName: true, lastName: true } },
          expertProfile: { select: { firstName: true, lastName: true } },
        },
      }).then((rows) => {
        for (const r of rows) {
          const name =
            (r.customerProfile && [r.customerProfile.firstName, r.customerProfile.lastName].filter(Boolean).join(" ")) ||
            (r.expertProfile && [r.expertProfile.firstName, r.expertProfile.lastName].filter(Boolean).join(" ")) ||
            r.email;
          targetMap.set(`User:${r.id}`, name || "User");
        }
      }).catch(() => {})
    );
  }

  await Promise.all(queries);
  return targetMap;
}

/**
 * GET /api/v1/admin/audit-log
 * Read-only, super-admin-only view of the immutable admin action trail.
 * Query: page, limit, action, module, adminId, search/q (empty string = no filter).
 */
export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);

    const action = req.query.action?.trim();
    const module = req.query.module?.trim();
    const adminId = req.query.adminId?.trim();
    const search = req.query.search?.trim() || req.query.q?.trim();

    const conditions = [];

    // Stored actions are namespaced ("verification.approve"), while the portal
    // filters by bare verbs ("approve") — match on `contains`, never rename.
    if (action) conditions.push({ action: { contains: action, mode: "insensitive" } });

    if (adminId) {
      if (!UUID_RE.test(adminId)) {
        // Passing a non-uuid straight to Prisma raises P2023 → 500.
        return next(badRequest("adminIdMustBeValidUuid", "BAD_REQUEST", "adminId"));
      }
      conditions.push({ actorAdminId: adminId });
    }

    if (module) {
      const mapped = MODULE_ENTITY_TYPES[module.toLowerCase()] ?? [];
      conditions.push({
        OR: [
          ...(mapped.length ? [{ entityType: { in: mapped } }] : []),
          { entityType: { contains: module, mode: "insensitive" } },
        ],
      });
    }

    if (search) {
      conditions.push({
        OR: [
          { action: { contains: search, mode: "insensitive" } },
          { entityType: { contains: search, mode: "insensitive" } },
          { entityId: { contains: search, mode: "insensitive" } },
          { ipAddress: { contains: search, mode: "insensitive" } },
          { actor: { name: { contains: search, mode: "insensitive" } } },
          { actor: { email: { contains: search, mode: "insensitive" } } },
        ],
      });
    }

    const where = conditions.length > 0 ? { AND: conditions } : {};

    const validSortFields = {
      createdAt: "createdAt",
      action: "action",
      module: "entityType",
    };
    const sortParam = req.query.sort?.trim();
    const orderParam = req.query.order?.trim()?.toLowerCase() === "asc" ? "asc" : "desc";
    const orderBy = {};

    if (sortParam && validSortFields[sortParam]) {
      orderBy[validSortFields[sortParam]] = orderParam;
    } else {
      orderBy.createdAt = "desc";
    }

    const [total, logs] = await Promise.all([
      db.adminAuditLog.count({ where }),
      db.adminAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          actor: { select: { id: true, name: true, email: true, role: true } },
        },
      }),
    ]);

    const targetMap = await resolveTargetNames(db, logs);

    const items = logs.map((log) => {
      const payload = log.payload && typeof log.payload === "object" ? log.payload : {};
      const resolvedName =
        targetMap.get(`${log.entityType}:${log.entityId}`) ||
        payload.title ||
        payload.name ||
        (payload.slug ? `Page: ${payload.slug}` : null) ||
        null;

      return {
        id: log.id,
        createdAt: log.createdAt,
        adminId: log.actorAdminId,
        adminName: log.actor?.name || log.actor?.email || "System",
        adminEmail: log.actor?.email || null,
        adminRole: log.actor?.role || null,
        action: log.action,
        module: log.entityType,
        targetId: log.entityId,
        targetName: resolvedName,
        details: summarizePayload(log.payload),
        payload,
        ipAddress: log.ipAddress,
      };
    });

    return ResponseFormatter.success(res, {
      message: getMessage("auditLogLoaded"),
      data: { items, page, limit, total },
    });
  } catch (err) {
    next(err);
  }
}
