import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["sent", "failed", "skipped"];
const SORT_FIELDS = { createdAt: "createdAt", status: "status", category: "category", subject: "subject", to: "toEmail" };

function parseDate(value, field, endOfDay) {
  if (!value) return null;
  const raw = String(value).trim();
  // Date-only input ("2026-10-22") covers the whole day when used as an upper bound.
  const d = new Date(endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw);
  if (Number.isNaN(d.getTime())) throw badRequest("invalidDateFilter", "BAD_REQUEST", field);
  return d;
}

function toListItem(row) {
  return {
    id: row.id,
    to: row.toEmail,
    from: row.fromEmail,
    subject: row.subject,
    category: row.category,
    status: row.status,
    provider: row.provider,
    errorMessage: row.errorMessage,
    service: row.service,
    createdAt: row.createdAt,
  };
}

/**
 * GET /api/v1/admin/email-logs
 * Query: page, limit, search/q (recipient, subject), status, category, dateFrom, dateTo, sort, order.
 * Response also carries `summary` (counts per status for the current non-status filters).
 */
export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);

    const status = req.query.status?.trim();
    const category = req.query.category?.trim();
    const search = req.query.search?.trim() || req.query.q?.trim();

    if (status && !STATUSES.includes(status)) return next(badRequest("invalidStatus", "BAD_REQUEST", "status"));

    const from = parseDate(req.query.dateFrom, "dateFrom", false);
    const to = parseDate(req.query.dateTo, "dateTo", true);

    const base = [];
    if (category) base.push({ category });
    if (from || to) base.push({ createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } });
    if (search) {
      base.push({
        OR: [
          { toEmail: { contains: search, mode: "insensitive" } },
          { subject: { contains: search, mode: "insensitive" } },
          { providerMessageId: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    const where = { AND: [...base, ...(status ? [{ status }] : [])] };

    const sortKey = SORT_FIELDS[req.query.sort?.trim()] ?? "createdAt";
    const order = req.query.order?.trim()?.toLowerCase() === "asc" ? "asc" : "desc";

    const [total, rows, grouped, categoryRows] = await Promise.all([
      db.emailLog.count({ where }),
      db.emailLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ [sortKey]: order }, { id: "desc" }],
        select: {
          id: true, toEmail: true, fromEmail: true, subject: true, category: true, status: true,
          provider: true, errorMessage: true, service: true, createdAt: true,
        },
      }),
      db.emailLog.groupBy({ by: ["status"], where: { AND: base }, _count: { _all: true } }),
      db.emailLog.groupBy({ by: ["category"], _count: { _all: true } }),
    ]);

    const summary = { sent: 0, failed: 0, skipped: 0 };
    for (const g of grouped) summary[g.status] = g._count._all;

    return ResponseFormatter.success(res, {
      message: getMessage("emailLogsLoaded"),
      data: {
        items: rows.map(toListItem),
        page,
        limit,
        total,
        summary,
        categories: categoryRows.map((c) => c.category).sort(),
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/admin/email-logs/:id — full record including stored body (null for sensitive mails). */
export async function getById(req, res, next) {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return next(notFound("emailLogNotFound"));
    const row = await getDb().emailLog.findUnique({ where: { id } });
    if (!row) return next(notFound("emailLogNotFound"));

    return ResponseFormatter.success(res, {
      message: getMessage("emailLogLoaded"),
      data: {
        ...toListItem(row),
        providerMessageId: row.providerMessageId,
        htmlBody: row.htmlBody,
        textBody: row.textBody,
      },
    });
  } catch (err) {
    next(err);
  }
}
