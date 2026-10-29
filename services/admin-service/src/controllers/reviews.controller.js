import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { recalculateExpertRating } from "@xprtlink/shared/utils/rating.js";
import { notFound, badRequest } from "@xprtlink/shared/utils/errors.js";

export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const status = req.query.status;
    const where = status ? { status } : {};
    const [total, items] = await Promise.all([
      db.review.count({ where }),
      db.review.findMany({
        where, skip, take: limit, orderBy: { createdAt: "desc" },
        include: {
          expert: { select: { firstName: true, lastName: true } },
          customer: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);
    return ResponseFormatter.paginated(res, { items, page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const db = getDb();
    const r = await db.review.findUnique({
      where: { id: req.params.id },
      include: { expert: true, customer: true, consultation: true },
    });
    if (!r) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    return ResponseFormatter.success(res, { data: r });
  } catch (err) { next(err); }
}

export async function hide(req, res, next) {
  try {
    const db = getDb();
    const r = await db.review.update({ where: { id: req.params.id }, data: { status: "hidden" } });
    await recalculateExpertRating(r.expertId);
    return ResponseFormatter.success(res, { message: getMessage("reviewHidden"), data: r });
  } catch (err) { next(err); }
}

export async function publish(req, res, next) {
  try {
    const db = getDb();
    const r = await db.review.update({ where: { id: req.params.id }, data: { status: "published" } });
    await recalculateExpertRating(r.expertId);
    return ResponseFormatter.success(res, { message: getMessage("reviewPublished"), data: r });
  } catch (err) { next(err); }
}

const fullName = (p) => `${p?.firstName || ""} ${p?.lastName || ""}`.trim() || "Unknown";

export async function listReports(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const status = req.query.status;
    const where = status ? { status } : {};
    const [total, items] = await Promise.all([
      db.reviewReport.count({ where }),
      db.reviewReport.findMany({
        where, skip, take: limit, orderBy: { createdAt: "desc" },
        include: {
          review: {
            include: {
              customer: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
              expert:   { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
            },
          },
          reporterCustomer: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
          reporterExpert:   { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
        },
      }),
    ]);
    const mapped = items.map((rr) => ({
      id: rr.id,
      reason: rr.reason,
      details: rr.details,
      status: rr.status,
      reporterRole: rr.reporterRole,
      createdAt: rr.createdAt,
      reporter: rr.reporterRole === "customer"
        ? { id: rr.reporterCustomer?.id, name: fullName(rr.reporterCustomer), email: rr.reporterCustomer?.user?.email ?? null }
        : { id: rr.reporterExpert?.id,   name: fullName(rr.reporterExpert),   email: rr.reporterExpert?.user?.email ?? null },
      review: {
        id: rr.review.id,
        rating: rr.review.rating,
        comment: rr.review.comment,
        status: rr.review.status,
        createdAt: rr.review.createdAt,
        reviewer: { id: rr.review.customer?.id, name: fullName(rr.review.customer), email: rr.review.customer?.user?.email ?? null },
        expert:   { id: rr.review.expert?.id,   name: fullName(rr.review.expert),   email: rr.review.expert?.user?.email ?? null },
      },
    }));
    return ResponseFormatter.paginated(res, { message: getMessage("reviewReportsLoaded"), items: mapped, page, limit, total });
  } catch (err) { next(err); }
}

export async function updateReport(req, res, next) {
  try {
    const db = getDb();
    const { status } = req.body;
    if (!status) throw badRequest("missingRequiredFields");
    const rr = await db.reviewReport.update({ where: { id: req.params.reportId }, data: { status } }).catch(() => null);
    if (!rr) throw notFound("resourceNotFound");
    return ResponseFormatter.success(res, { message: getMessage("reviewReportUpdated"), data: rr });
  } catch (err) { next(err); }
}
