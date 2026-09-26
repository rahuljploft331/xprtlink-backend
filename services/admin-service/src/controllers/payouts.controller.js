import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { logAdminAction } from "#utils/audit.js";
import { assertUuid, billingGet, billingPost } from "#utils/billingClient.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";

const EXPERT_SELECT = { id: true, firstName: true, lastName: true, currency: true };

function toAdminPayout(p) {
  return {
    id: p.id,
    expertProfileId: p.expertProfileId,
    expert: p.expert
      ? { id: p.expert.id, firstName: p.expert.firstName, lastName: p.expert.lastName }
      : null,
    expertName: p.expert ? `${p.expert.firstName ?? ""} ${p.expert.lastName ?? ""}`.trim() : null,
    amountCents: p.amountCents,
    currency: p.currency,
    status: p.status,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    stripeTransferId: p.stripeTransferId,
    ledgerEntries: p._count?.ledgerEntries,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.expertProfileId) where.expertProfileId = req.query.expertProfileId;
    const [total, items] = await Promise.all([
      db.expertPayout.count({ where }),
      db.expertPayout.findMany({
        where, skip, take: limit, orderBy: { createdAt: "desc" },
        include: { expert: { select: EXPERT_SELECT } },
      }),
    ]);
    return ResponseFormatter.paginated(res, { items: items.map(toAdminPayout), page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const db = getDb();
    const p = await db.expertPayout.findUnique({
      where: { id: req.params.id },
      include: { expert: { select: EXPERT_SELECT }, _count: { select: { ledgerEntries: true } } },
    });
    if (!p) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
    return ResponseFormatter.success(res, { data: toAdminPayout(p) });
  } catch (err) { next(err); }
}

/**
 * GET /admin/payouts/experts/:expertProfileId/summary
 * Unpaid balance + live Stripe readiness for the "Pay out now" panel.
 */
export async function expertSummary(req, res, next) {
  try {
    const data = await billingGet(`/payouts/experts/${assertUuid(req.params.expertProfileId, "expertProfileId")}/summary`);
    return ResponseFormatter.success(res, { message: getMessage("payoutSummaryLoaded"), data });
  } catch (err) { next(err); }
}

/**
 * POST /admin/payouts/experts/:expertProfileId/pay   { amountCents? }
 * Pay the expert now, outside the schedule: the whole unpaid balance, or an
 * exact amount (oldest earnings first; billing splits a call if needed).
 */
export async function payExpertNow(req, res, next) {
  try {
    const raw = req.body?.amountCents;
    const amountCents = raw === undefined || raw === null || raw === "" ? undefined : Number(raw);
    if (amountCents !== undefined && (!Number.isInteger(amountCents) || amountCents <= 0)) {
      throw badRequest("payoutAmountInvalid", "INVALID_AMOUNT", "amountCents");
    }
    const data = await billingPost(`/payouts/experts/${assertUuid(req.params.expertProfileId, "expertProfileId")}/pay-now`, {
      adminUserId: req.adminUser.id,
      amountCents,
    });
    await logAdminAction(req, "payout.payNow", "ExpertPayout", data.payout?.id, {
      expertProfileId: req.params.expertProfileId,
      mode: amountCents === undefined ? "full_balance" : "custom_amount",
      requestedCents: amountCents ?? null,
      amountCents: data.payout?.amountCents,
      remainingUnpaidCents: data.remainingUnpaidCents,
      transferred: data.transferred,
      error: data.error,
    });
    return ResponseFormatter.success(res, {
      message: getMessage(data.transferred ? "payoutSent" : "payoutTransferFailed"),
      data,
    });
  } catch (err) { next(err); }
}

/**
 * POST /admin/payouts/:id/retry
 * Re-send the Stripe transfer of a failed payout (idempotent per payout).
 */
export async function retry(req, res, next) {
  try {
    const data = await billingPost(`/payouts/${assertUuid(req.params.id)}/retry`, { adminUserId: req.adminUser.id });
    await logAdminAction(req, "payout.retry", "ExpertPayout", req.params.id, {
      transferred: data.transferred,
      error: data.error,
    });
    return ResponseFormatter.success(res, {
      message: getMessage(data.transferred ? "payoutSent" : "payoutTransferFailed"),
      data,
    });
  } catch (err) { next(err); }
}

/**
 * PATCH /admin/payouts/:id/mark-paid
 * Record that a FAILED payout was settled outside Stripe (e.g. manual bank
 * transfer). Moves no money, so it requires a note and is refused for any
 * other status — marking a processing/pending payout paid would hide an
 * unsent transfer from the retry job.
 */
export async function markPaid(req, res, next) {
  try {
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (note.length < 5) throw badRequest("payoutSettleNoteRequired", "VALIDATION_ERROR", "note");

    const db = getDb();
    const existing = await db.expertPayout.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("payoutNotFound");
    if (existing.status !== "failed") throw badRequest("payoutMarkPaidOnlyFailed", "INVALID_STATUS");

    const p = await db.expertPayout.update({
      where: { id: req.params.id },
      data: { status: "paid" },
      include: { expert: { select: EXPERT_SELECT } },
    });
    await logAdminAction(req, "payout.markPaidOutsideStripe", "ExpertPayout", p.id, {
      amountCents: p.amountCents,
      note,
    });
    return ResponseFormatter.success(res, { message: getMessage("payoutMarkedAsPaid"), data: toAdminPayout(p) });
  } catch (err) { next(err); }
}
