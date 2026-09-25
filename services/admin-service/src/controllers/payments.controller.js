import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logAdminAction } from "#utils/audit.js";
import { assertUuid, billingPost } from "#utils/billingClient.js";

// Only what the portal renders — never whole profile rows (Stripe ids, etc.).
const PARTY_SELECT = { id: true, firstName: true, lastName: true };

export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const [total, items] = await Promise.all([
      db.transaction.count(),
      db.transaction.findMany({
        skip, take: limit, orderBy: { createdAt: "desc" },
        include: {
          consultationCharge: {
            include: { consultation: { select: { id: true, billingStatus: true } } },
          },
        },
      }),
    ]);
    const mapped = items.map((t) => ({
      ...t,
      party: t.consultationCharge?.consultation
        ? `Consultation #${t.consultationCharge.consultation.id.slice(-6)}`
        : t.type,
    }));
    return ResponseFormatter.paginated(res, { items: mapped, page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const db = getDb();
    const t = await db.transaction.findUnique({
      where: { id: req.params.id },
      include: {
        consultationCharge: {
          include: {
            consultation: {
              select: {
                id: true,
                status: true,
                billingStatus: true,
                durationSeconds: true,
                customer: { select: PARTY_SELECT },
                expert: { select: PARTY_SELECT },
                earningsLedger: { select: { payoutId: true } },
              },
            },
          },
        },
      },
    });
    if (!t) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });

    // Refundable = a succeeded consultation charge whose expert share has not
    // been paid out yet (billing enforces the same rule).
    const consultation = t.consultationCharge?.consultation;
    const refundable =
      t.type === "consultation_charge" &&
      t.status === "succeeded" &&
      consultation?.billingStatus === "charged" &&
      !consultation.earningsLedger.some((row) => row.payoutId);

    return ResponseFormatter.success(res, { data: { ...t, refundable } });
  } catch (err) { next(err); }
}

/**
 * POST /admin/payments/:id/refund  { reason }
 * Full refund of the consultation this charge belongs to (hold capture and any
 * overage charge), executed by billing-service on Stripe.
 */
export async function refund(req, res, next) {
  try {
    const db = getDb();
    const t = await db.transaction.findUnique({
      where: { id: assertUuid(req.params.id) },
      include: { consultationCharge: { select: { consultationId: true } } },
    });
    if (!t) throw notFound("transactionNotFound");

    const consultationId = t.consultationCharge?.consultationId ?? t.metadata?.consultationId;
    if (t.type !== "consultation_charge" || !consultationId) {
      throw badRequest("transactionNotLinkedToConsultation", "NOT_REFUNDABLE");
    }

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : null;
    const data = await billingPost(`/consultations/${assertUuid(consultationId)}/refund`, {
      reason,
      adminUserId: req.adminUser.id,
    });
    await logAdminAction(req, "payment.refund", "Consultation", consultationId, {
      transactionId: t.id,
      refundedCents: data.refundedCents,
      reason,
    });
    return ResponseFormatter.success(res, { message: getMessage("consultationRefunded"), data });
  } catch (err) { next(err); }
}
