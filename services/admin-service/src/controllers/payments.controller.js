import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logAdminAction } from "#utils/audit.js";
import { assertUuid, billingPost } from "#utils/billingClient.js";

// Only what the portal renders — never whole profile rows (Stripe ids, etc.).
const PARTY_SELECT = { id: true, firstName: true, lastName: true };

function formatBrand(brand) {
  if (!brand) return "Card";
  return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
}

export function resolvePaymentInfo(t, customerPm = null) {
  const meta = t.metadata || {};
  let brand = meta.brand || customerPm?.brand || null;
  let last4 = meta.last4 || customerPm?.last4 || null;
  let method = meta.paymentMethod || null;
  let gateway = "Stripe";

  if (meta.store) {
    const s = String(meta.store).toLowerCase();
    if (s === "apple") {
      gateway = "Apple App Store";
      method = method || "Apple Pay";
    } else if (s === "google") {
      gateway = "Google Play";
      method = method || "Google Play";
    } else {
      gateway = s.toUpperCase();
      method = method || "In-App Purchase";
    }
  }

  if (t.type === "subscription" && !method) {
    method = meta.store ? (meta.store === "apple" ? "Apple Pay" : "Google Play") : "In-App Purchase";
  }

  if (brand && last4 && !method) {
    method = `${formatBrand(brand)} •••• ${last4}`;
  } else if (brand && !method) {
    method = formatBrand(brand);
  }

  if (t.type === "refund") {
    if (!method || method === "Card") {
      method = brand && last4 ? `Refund (${formatBrand(brand)} •••• ${last4})` : "Original Payment Method";
    }
  }

  if (!method) {
    method = "Card";
  }

  return {
    method,
    paymentMethod: brand || last4 ? { brand, last4, type: "card" } : null,
    gateway,
  };
}

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
            include: {
              consultation: {
                select: {
                  id: true,
                  billingStatus: true,
                  customerId: true,
                  customer: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      paymentMethods: {
                        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
                        take: 1,
                        select: { brand: true, last4: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const missingCustIds = [
      ...new Set(
        items
          .filter((t) => !t.consultationCharge?.consultation?.customer && t.metadata?.customerProfileId)
          .map((t) => t.metadata.customerProfileId)
      ),
    ];

    const extraPms = new Map();
    if (missingCustIds.length > 0) {
      const pms = await db.paymentMethod.findMany({
        where: { customerProfileId: { in: missingCustIds } },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        select: { customerProfileId: true, brand: true, last4: true },
      });
      for (const pm of pms) {
        if (!extraPms.has(pm.customerProfileId)) {
          extraPms.set(pm.customerProfileId, pm);
        }
      }
    }

    const mapped = items.map((t) => {
      const customer = t.consultationCharge?.consultation?.customer;
      const pm = customer?.paymentMethods?.[0] || (t.metadata?.customerProfileId ? extraPms.get(t.metadata.customerProfileId) : null);
      const { method, paymentMethod, gateway } = resolvePaymentInfo(t, pm);
      return {
        ...t,
        party: t.consultationCharge?.consultation
          ? `Consultation #${t.consultationCharge.consultation.id.slice(-6)}`
          : t.type,
        method,
        paymentMethod,
        gateway,
      };
    });
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
                customer: {
                  select: {
                    ...PARTY_SELECT,
                    paymentMethods: {
                      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
                      take: 1,
                      select: { brand: true, last4: true },
                    },
                  },
                },
                expert: { select: PARTY_SELECT },
                earningsLedger: { select: { payoutId: true } },
              },
            },
          },
        },
      },
    });
    if (!t) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });

    let pm = t.consultationCharge?.consultation?.customer?.paymentMethods?.[0] || null;
    if (!pm && t.metadata?.customerProfileId) {
      pm = await db.paymentMethod.findFirst({
        where: { customerProfileId: t.metadata.customerProfileId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        select: { brand: true, last4: true },
      });
    }

    const { method, paymentMethod, gateway } = resolvePaymentInfo(t, pm);

    // Refundable = a succeeded consultation charge whose expert share has not
    // been paid out yet (billing enforces the same rule).
    const consultation = t.consultationCharge?.consultation;
    const refundable =
      t.type === "consultation_charge" &&
      t.status === "succeeded" &&
      consultation?.billingStatus === "charged" &&
      !consultation.earningsLedger.some((row) => row.payoutId);

    return ResponseFormatter.success(res, {
      data: {
        ...t,
        method,
        paymentMethod,
        gateway,
        refundable,
      },
    });
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
