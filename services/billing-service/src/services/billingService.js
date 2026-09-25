import { getDb } from "@xprtlink/shared/db";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "billingService" });
import {
  toEarningsEntryDto,
  toExpertPayoutDto,
  toExpertSubscriptionDto,
  toPaymentMethodDto,
  toSubscriptionPlanDto,
  toTransactionDto,
} from "@xprtlink/shared/mappers/billing.mapper.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "@xprtlink/shared/utils/errors.js";
import { parsePagination, paginatedResult } from "@xprtlink/shared/utils/pagination.js";
import * as stripeSvc from "./stripeService.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import {
  computeConsultationChargeCents,
  computeConsultationCommissionCents,
  CONSULTATION_COMMISSION_RATE,
  consultationHoldMinimumCents,
} from "@xprtlink/shared/lib/consultationBilling.js";
import { sendEmail } from "@xprtlink/shared/lib/email.js";
import { buildConsultationInvoiceEmail } from "@xprtlink/shared/lib/consultationInvoice.js";
import { PAYOUT_SCHEDULE_DEFAULT_DAYS } from "@xprtlink/shared/contracts/settings.schema.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { customerDisplayName } from "@xprtlink/shared/mappers/common.js";
import { expertDisplayName } from "@xprtlink/shared/mappers/expert.mapper.js";

export {
  computeConsultationChargeCents,
  computeConsultationCommissionCents,
  CONSULTATION_COMMISSION_RATE,
};

export async function listPaymentMethods(auth) {
  const rows = await getDb().paymentMethod.findMany({
    where: { customerProfileId: auth.customerProfileId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toPaymentMethodDto);
}

export async function addPaymentMethod(auth, body) {
  const db = getDb();

  // 1. Lookup customer profile with user info
  const customerProfile = await db.customerProfile.findUnique({
    where: { id: auth.customerProfileId },
    include: { user: true },
  });

  // 2. Create Stripe Customer if not already created
  let stripeCustomerId = customerProfile.stripeCustomerId;
  if (!stripeCustomerId) {
    let newStripeCustomerId;
    try {
      const stripeCustomer = await stripeSvc.getOrCreateStripeCustomer({
        email: customerProfile.user.email,
        name: `${customerProfile.firstName} ${customerProfile.lastName}`,
      });
      newStripeCustomerId = stripeCustomer.id;
    } catch (err) {
      throw { statusCode: 502, code: "STRIPE_CUSTOMER_CREATION_FAILED", message: err.message };
    }

    try {
      await db.customerProfile.update({
        where: { id: auth.customerProfileId },
        data: { stripeCustomerId: newStripeCustomerId },
      });
      stripeCustomerId = newStripeCustomerId;
    } catch (dbErr) {
      // Concurrent request already wrote a stripeCustomerId — read it back instead of crashing.
      if (dbErr.code === "P2002") {
        const refreshed = await db.customerProfile.findUnique({
          where: { id: auth.customerProfileId },
          select: { stripeCustomerId: true },
        });
        stripeCustomerId = refreshed.stripeCustomerId;
        log.warn(`[billing] Concurrent Stripe customer creation race resolved — using existing ${stripeCustomerId}`);
      } else {
        throw { statusCode: 502, code: "STRIPE_CUSTOMER_CREATION_FAILED", message: dbErr.message };
      }
    }
  }

  // 3. Attach PaymentMethod to Stripe Customer (non-fatal in test mode)
  try {
    await stripeSvc.attachPaymentMethod({
      stripePaymentMethodId: body.stripePaymentMethodId,
      stripeCustomerId,
    });
  } catch (attachErr) {
    // In test mode, pm_card_* tokens may not be attachable — log and continue
    log.warn(`[billing] Stripe attach PM failed (non-fatal): ${attachErr.message}`);
  }

  // 4. Persist locally — upsert to avoid duplicate stripe_payment_method_id constraint errors
  //    (Stripe may resend the same payment method token on retries or duplicate client calls)
  if (body.setDefault) {
    await db.paymentMethod.updateMany({
      where: { customerProfileId: auth.customerProfileId },
      data: { isDefault: false },
    });
  }

  // Attempt to fetch real card metadata from Stripe (falls back to client-supplied values).
  // Fetched up front so the fingerprint is available for card-level dedup below.
  let brand = body.brand;
  let last4 = body.last4;
  let expMonth = body.expMonth;
  let expYear = body.expYear;
  let fingerprint = null;
  try {
    const pmDetails = await stripeSvc.retrievePaymentMethod({ stripePaymentMethodId: body.stripePaymentMethodId });
    if (pmDetails?.card) {
      brand = pmDetails.card.brand || brand;
      last4 = pmDetails.card.last4 || last4;
      expMonth = pmDetails.card.exp_month || expMonth;
      expYear = pmDetails.card.exp_year || expYear;
      fingerprint = pmDetails.card.fingerprint || null;
    }
  } catch (err) {
    // Non-fatal — use client-supplied values (test mode pm_card_* may not be retrievable)
    log.warn(`[billing] Stripe retrieve PM metadata failed (non-fatal): ${err.message}`);
  }

  // Dedup: match on the same Stripe token (idempotent retries) OR the same card
  // fingerprint (same physical card re-tokenized into a different pm_... token).
  const existing = await db.paymentMethod.findFirst({
    where: {
      customerProfileId: auth.customerProfileId,
      OR: [
        { stripePaymentMethodId: body.stripePaymentMethodId },
        ...(fingerprint ? [{ fingerprint }] : []),
      ],
    },
  });

  if (existing) {
    // If this is the exact same Stripe token, treat as idempotent and return it
    // (optionally promoting it to default). A fingerprint-only match means the
    // customer is trying to add a card they already saved — reject it.
    if (existing.stripePaymentMethodId !== body.stripePaymentMethodId) {
      throw conflict("paymentMethodDuplicateCard");
    }
    if (body.setDefault && !existing.isDefault) {
      const updated = await db.paymentMethod.update({
        where: { id: existing.id },
        data: { isDefault: true },
      });
      return toPaymentMethodDto(updated);
    }
    return toPaymentMethodDto(existing);
  }

  const isFirst = (await db.paymentMethod.count({ where: { customerProfileId: auth.customerProfileId } })) === 0;

  const method = await db.paymentMethod.create({
    data: {
      customerProfileId: auth.customerProfileId,
      stripePaymentMethodId: body.stripePaymentMethodId,
      fingerprint,
      brand,
      last4,
      expMonth,
      expYear,
      isDefault: body.setDefault ?? isFirst,
    },
  });

  return toPaymentMethodDto(method);
}

export async function removePaymentMethod(auth, methodId) {
  const db = getDb();
  const method = await db.paymentMethod.findFirst({
    where: { id: methodId, customerProfileId: auth.customerProfileId },
  });
  if (!method) throw notFound("paymentMethodNotFound");

  // Detach from Stripe (non-fatal — local record is still deleted regardless)
  try {
    await stripeSvc.detachPaymentMethod({ stripePaymentMethodId: method.stripePaymentMethodId });
  } catch (err) {
    log.warn(`[billing] Stripe detach PM failed (non-fatal): ${err.message}`);
  }

  await db.paymentMethod.delete({ where: { id: method.id } });

  if (method.isDefault) {
    const next = await db.paymentMethod.findFirst({
      where: { customerProfileId: auth.customerProfileId },
      orderBy: { createdAt: "desc" },
    });
    if (next) {
      await db.paymentMethod.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }

  return { removed: true };
}

export async function setDefaultPaymentMethod(auth, methodId) {
  const db = getDb();
  
  const method = await db.paymentMethod.findFirst({
    where: { id: methodId, customerProfileId: auth.customerProfileId },
  });
  if (!method) throw notFound("paymentMethodNotFound");

  await db.paymentMethod.updateMany({
    where: { customerProfileId: auth.customerProfileId },
    data: { isDefault: false },
  });

  const updated = await db.paymentMethod.update({
    where: { id: methodId },
    data: { isDefault: true },
  });

  return toPaymentMethodDto(updated);
}

/** Consultation states in which the customer may (re)place the pre-call hold. */
const HOLDABLE_STATUSES = ["requested", "ringing"];

/** Consultation states whose hold must be released rather than captured. */
const HOLD_RELEASE_STATUSES = ["declined", "canceled", "failed"];

const NOTIFICATION_URL = () => process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";

/** Commission rate (fraction) from platform settings; tolerant of string rows. */
async function getCommissionRate(db) {
  const row = await db.platformSetting.findUnique({ where: { key: "commissionPercent" } });
  const percent = Number(row?.value);
  return row && Number.isFinite(percent) && percent >= 0 && percent <= 100
    ? percent / 100
    : CONSULTATION_COMMISSION_RATE;
}

/** Stripe returns related objects as ids unless expanded. */
function stripeId(value) {
  return typeof value === "string" ? value : value?.id ?? null;
}

export async function holdConsultationFunds(auth, consultationId, body) {
  const db = getDb();

  const consultation = await db.consultation.findFirst({
    where: { id: consultationId, customerId: auth.customerProfileId },
    include: { expert: true },
  });
  if (!consultation) throw notFound("consultationNotFound");
  if (consultation.billingStatus === "charged") throw conflict("consultationAlreadyPaid", "ALREADY_PAID");
  // A hold only makes sense before the expert accepts; after that the call is
  // settled from the existing hold, and a terminal consultation must not hold funds.
  if (!HOLDABLE_STATUSES.includes(consultation.status)) {
    throw badRequest("consultationNotHoldable", "INVALID_STATUS");
  }

  // Retrieve customer with stripeCustomerId
  const customerProfile = await db.customerProfile.findUnique({
    where: { id: auth.customerProfileId },
  });
  if (!customerProfile.stripeCustomerId) {
    throw badRequest("noStripeCustomerFound", "NO_STRIPE_CUSTOMER");
  }

  let paymentMethod;
  if (body.paymentMethodId) {
    paymentMethod = await db.paymentMethod.findFirst({
      where: { id: body.paymentMethodId, customerProfileId: auth.customerProfileId },
    });
  } else {
    paymentMethod = await db.paymentMethod.findFirst({
      where: { customerProfileId: auth.customerProfileId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
  }
  if (!paymentMethod) throw notFound("paymentMethodNotFound");

  // Listed rate is per 30 minutes. Hold one block, or $30, whichever is larger.
  const serverMinimumCents = consultationHoldMinimumCents(consultation.ratePerMinuteCents);
  const estimatedCents = Math.max(body.estimatedCents || 0, serverMinimumCents);

  let holdResult;
  try {
    holdResult = await stripeSvc.createPreAuthHold({
      customerStripeId: customerProfile.stripeCustomerId,
      stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
      amountCents: estimatedCents,
      currency: consultation.expert?.currency || "USD",
      metadata: { consultationId, customerProfileId: auth.customerProfileId },
      consultationId,
    });
  } catch (err) {
    // 402, not 5xx: the error handler hides 5xx messages, and the customer needs
    // Stripe's reason (e.g. "Your card was declined.") to pick another card.
    throw new AppError(err.message, { statusCode: 402, code: "HOLD_FAILED" });
  }

  // Persist the PaymentIntent ID on the consultation so room_close can capture it
  await db.consultation.update({
    where: { id: consultationId },
    data: { stripePaymentIntentId: holdResult.id, holdReleasedAt: null },
  });

  // A re-hold (new card / retry) supersedes the previous authorization — release
  // it so the customer is never holding two amounts for one consultation.
  const previousPaymentIntentId = consultation.stripePaymentIntentId;
  if (previousPaymentIntentId && previousPaymentIntentId !== holdResult.id) {
    stripeSvc
      .cancelPaymentIntent(previousPaymentIntentId, { reason: "duplicate" })
      .catch((err) => log.error(`[billing] release superseded hold ${previousPaymentIntentId} failed: ${err.message}`));
  }

  return {
    consultationId,
    holdStatus: holdResult.status,
    stripePaymentIntentId: holdResult.id,
    amountCents: estimatedCents,
    authorized: true,
  };
}

/**
 * Collect `amountCents` for a consultation from Stripe.
 *
 *   1. Capture the pre-call hold, up to what it can cover (amount_capturable).
 *      If the hold was already captured (a retry after the DB write failed),
 *      count what Stripe actually received instead of capturing again.
 *   2. Charge any remainder off-session — the call ran past the hold, or the
 *      hold expired/was cancelled. Card preference: the card the customer chose
 *      (manual pay) → the hold's card → the customer's default card.
 *
 * Every Stripe call is idempotency-keyed on the consultation and amounts, so a
 * retry can never double-charge.
 *
 * @returns {Promise<{payments: Array<{paymentIntentId:string, amountCents:number, kind:string}>, collectedCents:number, shortfallCents:number, error: Error|null}>}
 */
async function collectConsultationPayment({ consultation, amountCents, currency, explicitCard }) {
  const payments = [];
  let collectedCents = 0;
  let lastError = null;
  let holdPi = null;

  if (consultation.stripePaymentIntentId) {
    try {
      holdPi = await stripeSvc.retrievePaymentIntent(consultation.stripePaymentIntentId);
      if (holdPi.status === "requires_capture") {
        const toCapture = Math.min(amountCents, holdPi.amount_capturable);
        try {
          holdPi = await stripeSvc.capturePaymentIntent({
            paymentIntentId: holdPi.id,
            amountToCaptureCents: toCapture,
          });
        } catch (err) {
          lastError = err;
          // A concurrent or earlier capture may have landed — re-read before giving up.
          holdPi = await stripeSvc.retrievePaymentIntent(holdPi.id);
        }
      }
      if (holdPi.status === "succeeded" && holdPi.amount_received > 0) {
        payments.push({ paymentIntentId: holdPi.id, amountCents: holdPi.amount_received, kind: "hold_capture" });
        collectedCents += holdPi.amount_received;
      }
    } catch (err) {
      lastError = err;
      log.error(`[billing] hold capture for ${consultation.id} failed: ${err.message}`);
    }
  }

  const remainderCents = amountCents - collectedCents;
  if (remainderCents > 0) {
    let card = explicitCard ?? null;
    if (!card && stripeId(holdPi?.customer) && stripeId(holdPi?.payment_method)) {
      card = {
        customerStripeId: stripeId(holdPi.customer),
        stripePaymentMethodId: stripeId(holdPi.payment_method),
      };
    }
    if (!card) card = await loadDefaultCard(consultation.customerId);

    if (card) {
      try {
        const extra = await stripeSvc.createAndConfirmPaymentIntent({
          customerStripeId: card.customerStripeId,
          stripePaymentMethodId: card.stripePaymentMethodId,
          amountCents: remainderCents,
          currency,
          metadata: {
            consultationId: consultation.id,
            customerProfileId: consultation.customerId,
            kind: collectedCents > 0 ? "overage" : "direct",
          },
          idempotencyKey: `charge_${consultation.id}_${card.stripePaymentMethodId}_${collectedCents}_${remainderCents}`,
        });
        if (extra.status === "succeeded") {
          payments.push({
            paymentIntentId: extra.id,
            amountCents: remainderCents,
            kind: collectedCents > 0 ? "overage" : "direct",
          });
          collectedCents += remainderCents;
        } else {
          lastError = new Error(`PaymentIntent ${extra.id} is ${extra.status}`);
        }
      } catch (err) {
        lastError = err;
        log.error(`[billing] off-session charge of ${remainderCents}¢ for ${consultation.id} failed: ${err.message}`);
      }
    } else if (!lastError) {
      lastError = new Error("No capturable hold and no card on file");
    }
  }

  return { payments, collectedCents, shortfallCents: amountCents - collectedCents, error: lastError };
}

/** The customer's default saved card, or null when they have none on Stripe. */
async function loadDefaultCard(customerProfileId) {
  const db = getDb();
  const [customerProfile, paymentMethod] = await Promise.all([
    db.customerProfile.findUnique({ where: { id: customerProfileId }, select: { stripeCustomerId: true } }),
    db.paymentMethod.findFirst({
      where: { customerProfileId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  if (!customerProfile?.stripeCustomerId || !paymentMethod) return null;
  return {
    customerStripeId: customerProfile.stripeCustomerId,
    stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
  };
}

/**
 * The single settlement path for a finished consultation — used by room_close
 * capture, the retry sweep, and the customer's manual pay. Idempotent: a
 * consultation that already has a charge is skipped.
 */
async function settleConsultation(consultationId, { durationSeconds, explicitCard = null, source }) {
  const db = getDb();

  const consultation = await db.consultation.findUnique({
    where: { id: consultationId },
    include: { expert: true, charge: true },
  });

  if (!consultation) {
    log.warn(`[billing] settleConsultation: consultation ${consultationId} not found`);
    return { skipped: true, reason: "not_found" };
  }

  if (["charged", "refunded"].includes(consultation.billingStatus) || consultation.charge) {
    log.info(`[billing] settleConsultation: ${consultationId} already charged — skipping`);
    return { skipped: true, reason: "already_charged" };
  }

  // Same helper for every path — they must never round differently.
  const amountCents = computeConsultationChargeCents(consultation, durationSeconds);

  if (amountCents <= 0) {
    log.info(`[billing] settleConsultation: ${consultationId} — zero amount, skipping charge`);
    return { skipped: true, reason: "zero_amount" };
  }

  const currency = consultation.expert?.currency || "USD";
  const rate = await getCommissionRate(db);
  const collection = await collectConsultationPayment({ consultation, amountCents, currency, explicitCard });

  if (collection.collectedCents <= 0) {
    await db.consultation.updateMany({
      where: { id: consultationId, billingStatus: { not: "charged" } },
      data: { billingStatus: "failed" },
    });
    notifyPaymentFailed(consultationId);
    return {
      skipped: false,
      captured: false,
      reason: consultation.stripePaymentIntentId ? "stripe_capture_failed" : "no_hold",
      error: collection.error?.message ?? null,
    };
  }

  // Record what Stripe actually collected. If the overage charge was declined the
  // customer paid only the hold — settle on that and flag the shortfall for ops.
  const chargedCents = collection.collectedCents;
  const shortfallCents = collection.shortfallCents;
  if (shortfallCents > 0) {
    log.error(
      `[billing] settleConsultation: ${consultationId} collected ${chargedCents}¢ of ${amountCents}¢ — shortfall ${shortfallCents}¢ (${collection.error?.message ?? "unknown"})`
    );
  }
  const commissionCents = computeConsultationCommissionCents(chargedCents, rate);
  const expertShareCents = chargedCents - commissionCents;

  let result;
  try {
    result = await db.$transaction(async (tx) => {
      const transactions = [];
      for (const payment of collection.payments) {
        transactions.push(
          await tx.transaction.create({
            data: {
              type: "consultation_charge",
              amountCents: payment.amountCents,
              currency,
              status: "succeeded",
              stripePaymentIntentId: payment.paymentIntentId,
              metadata: {
                consultationId,
                customerProfileId: consultation.customerId,
                source,
                kind: payment.kind,
                ...(shortfallCents > 0 ? { billedCents: amountCents, shortfallCents } : {}),
              },
            },
          })
        );
      }

      await tx.consultationCharge.create({
        data: {
          consultationId,
          transactionId: transactions[0].id,
          commissionCents,
          expertShareCents,
        },
      });

      await tx.expertEarningsLedger.create({
        data: {
          expertProfileId: consultation.expertId,
          consultationId,
          grossCents: chargedCents,
          commissionCents,
          netCents: expertShareCents,
        },
      });

      await tx.consultation.update({
        where: { id: consultationId },
        data: { billingStatus: "charged" },
      });

      return transactions[0];
    });
  } catch (err) {
    // A concurrent settlement (room_close vs retry vs manual pay) won the race.
    if (err?.code === "P2002") {
      log.info(`[billing] settleConsultation: ${consultationId} settled concurrently — skipping`);
      return { skipped: true, reason: "already_charged" };
    }
    throw err;
  }

  log.info(`[billing] settleConsultation: ${consultationId} → charged $${(chargedCents / 100).toFixed(2)} (${source})`);

  notifyPaymentSucceeded({ consultationId, amountCents: chargedCents, commissionCents, expertShareCents, currency, transactionId: result.id });

  return {
    captured: true,
    transactionId: result.id,
    amountCents: chargedCents,
    commissionCents,
    expertShareCents,
    shortfallCents,
  };
}

/** Tell the customer their consultation payment failed — non-fatal. */
function notifyPaymentFailed(consultationId) {
  (async () => {
    const consultation = await getDb().consultation.findUnique({
      where: { id: consultationId },
      include: { customer: { include: { user: true } } },
    });
    if (!consultation?.customer?.user?.id) return;
    await internalPost(NOTIFICATION_URL(), "/api/v1/notifications/dispatch", {
      userIds: [consultation.customer.user.id],
      type: "payment_failed",
      title: "Payment Failed",
      body: "We were unable to process your consultation payment. Please check your payment method and try again.",
      data: { consultationId },
    });
  })().catch((err) => log.error(`[settleConsultation] Failure notification failed: ${err.message}`));
}

/**
 * Notify customer (charge confirmation) and expert (earnings credit), and email
 * a soft-copy invoice to each party — non-fatal, off the response path.
 */
function notifyPaymentSucceeded({ consultationId, amountCents, commissionCents, expertShareCents, currency, transactionId }) {
  (async () => {
    const consultation = await getDb().consultation.findUnique({
      where: { id: consultationId },
      include: {
        customer: { include: { user: true } },
        expert: { include: { user: true } },
      },
    });
    const userIds = [consultation?.customer?.user?.id, consultation?.expert?.userId].filter(Boolean);
    if (userIds.length > 0) {
      await internalPost(NOTIFICATION_URL(), "/api/v1/notifications/dispatch", {
        userIds,
        type: "payment_succeeded",
        title: "Payment Successful",
        body: `Consultation payment of $${(amountCents / 100).toFixed(2)} was processed successfully.`,
        data: { consultationId, amountCents, transactionId },
      });
    }
    await sendConsultationInvoices({ consultation, amountCents, commissionCents, expertShareCents, currency });
  })().catch((err) => log.error(`[settleConsultation] Payment notification failed: ${err.message}`));
}

export async function payConsultation(auth, consultationId, body) {
  const db = getDb();

  const consultation = await db.consultation.findFirst({
    where: { id: consultationId, customerId: auth.customerProfileId },
    include: { charge: true },
  });
  if (!consultation) throw notFound("consultationNotFound");
  if (consultation.status !== "completed") {
    throw badRequest("consultationMustBeCompletedBeforePayment", "INVALID_STATE");
  }
  if (["charged", "refunded"].includes(consultation.billingStatus) || consultation.charge) {
    throw conflict("consultationAlreadyPaid", "ALREADY_PAID");
  }
  if (computeConsultationChargeCents(consultation) <= 0) {
    throw badRequest("nothingToCharge", "INVALID_AMOUNT");
  }

  const paymentMethod = await db.paymentMethod.findFirst({
    where: { id: body.paymentMethodId, customerProfileId: auth.customerProfileId },
  });
  if (!paymentMethod) throw notFound("paymentMethodNotFound");

  const customerProfile = await db.customerProfile.findUnique({
    where: { id: auth.customerProfileId },
    select: { stripeCustomerId: true },
  });
  if (!customerProfile?.stripeCustomerId) {
    throw badRequest("noStripeCustomerFound", "NO_STRIPE_CUSTOMER");
  }

  // The hold (if still capturable) is always used first; the chosen card covers
  // the rest. `body.stripePaymentIntentId` is ignored — the hold on record is the
  // only PaymentIntent this consultation may capture.
  const result = await settleConsultation(consultationId, {
    explicitCard: {
      customerStripeId: customerProfile.stripeCustomerId,
      stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
    },
    source: "customer_pay",
  });

  if (result.skipped && result.reason === "already_charged") {
    throw conflict("consultationAlreadyPaid", "ALREADY_PAID");
  }
  if (!result.captured) {
    // 402, not 5xx: the error handler hides 5xx messages, and the customer needs
    // Stripe's reason (e.g. "Your card was declined.").
    throw new AppError(result.error ?? getMessage("consultationPaymentFailed"), {
      statusCode: 402,
      code: "CAPTURE_FAILED",
    });
  }

  const transaction = await db.transaction.findUnique({ where: { id: result.transactionId } });
  return toTransactionDto(transaction);
}

/**
 * Internal service-to-service capture — called by engagement-service on room_close
 * and by the retry sweep. No customer auth required.
 */
export async function captureConsultation(consultationId, durationSeconds) {
  return settleConsultation(consultationId, { durationSeconds, source: "room_close" });
}

/**
 * Release (cancel) the pre-auth hold of a consultation that ended without a
 * billable call — declined, cancelled, never connected, or abandoned. Idempotent:
 * already-released, captured, or hold-less consultations are skipped.
 */
export async function releaseConsultationHold(consultationId) {
  const db = getDb();
  const consultation = await db.consultation.findUnique({
    where: { id: consultationId },
    include: { charge: true },
  });

  if (!consultation) return { released: false, reason: "not_found" };
  if (!consultation.stripePaymentIntentId) return { released: false, reason: "no_hold" };
  if (consultation.holdReleasedAt) return { released: false, reason: "already_released" };
  if (consultation.charge || consultation.billingStatus === "charged") {
    return { released: false, reason: "charged" };
  }
  if (!HOLD_RELEASE_STATUSES.includes(consultation.status)) {
    return { released: false, reason: "not_terminal" };
  }

  const pi = await stripeSvc.cancelPaymentIntent(consultation.stripePaymentIntentId);
  if (pi.status === "succeeded") {
    // Money was captured but no charge was recorded — never silently void that.
    log.error(
      `[billing] releaseConsultationHold: PI ${pi.id} for ${consultationId} (${consultation.status}) is captured with no charge row — needs manual review`
    );
    return { released: false, reason: "captured_without_charge" };
  }

  await db.consultation.update({
    where: { id: consultationId },
    data: { holdReleasedAt: new Date() },
  });
  log.info(`[billing] releaseConsultationHold: released ${pi.id} for ${consultationId} (${consultation.status})`);
  return { released: true, paymentIntentId: pi.id };
}

/**
 * Sweep: release holds that the per-event release missed, and expire abandoned
 * requests. A consultation still `requested`/`ringing` after `abandonMinutes`
 * was never answered — mark it failed (same as the engagement ghost cleanup)
 * so its hold is released and the expert can no longer accept it.
 */
export async function releaseStaleHolds({
  abandonMinutes = Number(process.env.HOLD_ABANDON_MINUTES || 60),
  limit = Number(process.env.HOLD_RELEASE_BATCH || 100),
} = {}) {
  const db = getDb();
  const abandonCutoff = new Date(Date.now() - abandonMinutes * 60 * 1000);

  // Never answered, or accepted but nobody ever joined the room.
  const abandoned = await db.consultation.updateMany({
    where: {
      OR: [
        { status: { in: HOLDABLE_STATUSES }, requestedAt: { lt: abandonCutoff } },
        { status: "accepted", startedAt: null, acceptedAt: { lt: abandonCutoff } },
      ],
    },
    data: { status: "failed", endedAt: new Date(), durationSeconds: 0 },
  });

  const candidates = await db.consultation.findMany({
    where: {
      status: { in: HOLD_RELEASE_STATUSES },
      stripePaymentIntentId: { not: null },
      holdReleasedAt: null,
      billingStatus: { not: "charged" },
    },
    select: { id: true },
    orderBy: { requestedAt: "asc" },
    take: limit,
  });

  let released = 0;
  let failed = 0;
  let skipped = 0;
  for (const c of candidates) {
    try {
      const result = await releaseConsultationHold(c.id);
      if (result.released) released += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      log.error(`[releaseStaleHolds] ${c.id} threw: ${err.message}`);
    }
  }

  log.info(
    `[releaseStaleHolds] abandoned=${abandoned.count} scanned=${candidates.length} released=${released} skipped=${skipped} failed=${failed}`
  );
  return { abandoned: abandoned.count, scanned: candidates.length, released, skipped, failed };
}

/**
 * Admin refund: return everything charged for a consultation (hold capture +
 * any overage charge) to the customer's card, and drop the expert's unpaid
 * earnings for it.
 *
 * Refused once the expert's share is part of a payout (sent, in flight, or
 * failed-but-owning): pulling money back from a Connect account is a transfer
 * reversal and needs a deliberate decision, not a button.
 *
 * Retry-safe: Stripe refunds are idempotency-keyed per PaymentIntent, and the
 * DB is only updated once every refund has been issued.
 */
export async function refundConsultation(consultationId, { reason, adminUserId } = {}) {
  const db = getDb();
  const consultation = await db.consultation.findUnique({
    where: { id: consultationId },
    include: { charge: true, earningsLedger: true, customer: { include: { user: true } } },
  });
  if (!consultation) throw notFound("consultationNotFound");
  if (consultation.billingStatus === "refunded") throw conflict("consultationAlreadyRefunded", "ALREADY_REFUNDED");
  if (!consultation.charge || consultation.billingStatus !== "charged") {
    throw badRequest("consultationNotCharged", "NOT_CHARGED");
  }
  if (consultation.earningsLedger.some((row) => row.payoutId)) {
    throw badRequest("refundBlockedEarningsPaidOut", "EARNINGS_PAID_OUT");
  }

  const charges = await db.transaction.findMany({
    where: {
      type: "consultation_charge",
      status: "succeeded",
      stripePaymentIntentId: { not: null },
      OR: [
        { id: consultation.charge.transactionId },
        { metadata: { path: ["consultationId"], equals: consultationId } },
      ],
    },
  });
  if (charges.length === 0) throw badRequest("consultationNotCharged", "NOT_CHARGED");

  const issued = [];
  for (const charge of charges) {
    try {
      const refund = await stripeSvc.refundPaymentIntent({
        paymentIntentId: charge.stripePaymentIntentId,
        metadata: { consultationId, transactionId: charge.id },
      });
      issued.push({ charge, refund });
    } catch (err) {
      log.error(`[refundConsultation] refund of ${charge.stripePaymentIntentId} failed: ${err.message}`);
      throw new AppError(err.message, { statusCode: 402, code: "REFUND_FAILED" });
    }
  }

  await db.$transaction(async (tx) => {
    await tx.transaction.updateMany({
      where: { id: { in: charges.map((c) => c.id) } },
      data: { status: "refunded" },
    });
    for (const { charge, refund } of issued) {
      await tx.transaction.create({
        data: {
          type: "refund",
          amountCents: refund.amount,
          currency: charge.currency,
          status: refund.status === "succeeded" ? "succeeded" : "pending",
          metadata: {
            consultationId,
            customerProfileId: consultation.customerId,
            refundedTransactionId: charge.id,
            stripeRefundId: refund.id,
            reason: reason ?? null,
            adminUserId: adminUserId ?? null,
          },
        },
      });
    }
    // The expert earns nothing for a refunded call. Only unpaid rows exist here
    // (checked above); the payoutId guard keeps a concurrent payout claim safe.
    await tx.expertEarningsLedger.deleteMany({ where: { consultationId, payoutId: null } });
    await tx.consultation.update({ where: { id: consultationId }, data: { billingStatus: "refunded" } });
  });

  const refundedCents = issued.reduce((sum, { refund }) => sum + refund.amount, 0);
  log.info(`[refundConsultation] admin ${adminUserId ?? "-"} refunded ${refundedCents}¢ for ${consultationId}`);

  const customerUserId = consultation.customer?.user?.id;
  if (customerUserId) {
    internalPost(NOTIFICATION_URL(), "/api/v1/notifications/dispatch", {
      userIds: [customerUserId],
      type: "payment_refunded",
      title: "Refund Issued",
      body: `A refund of $${(refundedCents / 100).toFixed(2)} for your consultation is on its way to your card.`,
      data: { consultationId, amountCents: refundedCents },
    }).catch((err) => log.error(`[refundConsultation] notify failed: ${err.message}`));
  }

  return {
    consultationId,
    refundedCents,
    refunds: issued.map(({ refund }) => ({ id: refund.id, status: refund.status, amountCents: refund.amount })),
  };
}

/**
 * Emails a soft-copy invoice to both parties after a consultation is charged:
 *   - Customer → receipt showing the debit (amount charged).
 *   - Expert   → earnings statement showing the credit (net after commission).
 * No push is sent — the Payment Successful notification already covers the charge.
 *
 * Every step is best-effort and independent — one failed email must not stop
 * the other, and none of this is on the billing capture response path.
 */
async function sendConsultationInvoices({
  consultation,
  amountCents,
  commissionCents,
  expertShareCents,
  currency,
}) {
  if (!consultation) return;

  const customerEmail = consultation.customer?.user?.email;
  const expertEmail = consultation.expert?.user?.email;
  const customerName = customerDisplayName(consultation.customer?.user, consultation.customer);
  const expertName = expertDisplayName(consultation.expert);

  const recipients = [
    {
      audience: "customer",
      email: customerEmail,
    },
    {
      audience: "expert",
      email: expertEmail,
    },
  ];

  for (const recipient of recipients) {
    if (!recipient.email) {
      log.warn(
        `[captureConsultation] No email for ${recipient.audience} on consultation ${consultation.id} — skipping invoice`
      );
      continue;
    }
    try {
      const { subject, html } = await buildConsultationInvoiceEmail({
        audience: recipient.audience,
        consultation,
        amountCents,
        commissionCents,
        expertShareCents,
        currency,
        expertName,
        customerName,
      });
      await sendEmail({ to: recipient.email, subject, html });
      log.info(
        `[captureConsultation] Invoice emailed to ${recipient.audience} (${recipient.email}) for consultation ${consultation.id}`
      );

      // No "Invoice Available" push — the Payment Successful notification already
      // covers the charge, and the receipt is delivered by email above.
    } catch (err) {
      log.error(
        `[captureConsultation] Failed to send invoice to ${recipient.audience} (${recipient.email}): ${err.message}`
      );
    }
  }
}

export async function submitCustomConnectKyc(auth, body) {
  const db = getDb();
  const expert = await db.expertProfile.findUnique({
    where: { id: auth.expertProfileId },
    include: { user: true },
  });

  if (!expert) throw notFound("expertProfileNotFound");

  const userPhone = expert.user.phone?.startsWith("+") ? expert.user.phone : undefined;
  const details = {
    expertEmail: expert.user.email,
    phone: body.phone ?? userPhone,
    firstName: body.firstName,
    lastName: body.lastName,
    dob: body.dob,
    address: body.address,
    ssnLast4: body.ssnLast4,
    idNumber: body.idNumber,
    frontDocumentFileId: body.frontDocumentFileId,
    backDocumentFileId: body.backDocumentFileId,
    userIpAddress: body.userIpAddress,
  };

  // Re-submission updates the existing account (keeps its bank account);
  // only a first submission creates one.
  const account = expert.stripeAccountId
    ? await stripeSvc.updateCustomConnectAccount(expert.stripeAccountId, details)
    : await stripeSvc.createCustomConnectAccount(details);

  if (!expert.stripeAccountId) {
    // Persist the Stripe Connect account ID so attachBankAccount can reference it
    await db.expertProfile.update({
      where: { id: auth.expertProfileId },
      data: { stripeAccountId: account.id },
    });
  }

  return {
    expertProfileId: auth.expertProfileId,
    stripeAccountId: account.id,
    kycStatus: "submitted",
    transfersActive: account.capabilities?.transfers === "active",
    requirementsDue: account.requirements?.currently_due ?? [],
  };
}

export async function attachBankAccount(auth, body) {
  const db = getDb();
  const expert = await db.expertProfile.findUnique({
    where: { id: auth.expertProfileId },
  });

  if (!expert) throw notFound("expertProfileNotFound");

  // Expert must have completed KYC (Stripe Custom Connect account) before adding a bank account
  if (!expert.stripeAccountId) {
    throw badRequest("kycRequiredBeforeBankAccount", "KYC_REQUIRED");
  }

  const externalAccount = await stripeSvc.attachExternalBankAccount({
    stripeAccountId: expert.stripeAccountId,
    routingNumber: body.routingNumber,
    accountNumber: body.accountNumber,
    accountHolderName: body.accountHolderName,
  });

  return {
    expertProfileId: auth.expertProfileId,
    bankAccountId: externalAccount.id,
    status: "active",
  };
}

export async function handleStripeWebhook(payload, signature) {
  const event = stripeSvc.constructWebhookEvent(payload, signature);
  const db = getDb();

  // Webhook event deduplication — prevent processing the same event twice on retries
  const alreadyProcessed = await db.processedWebhookEvent.findUnique({
    where: { id: event.id },
  });
  if (alreadyProcessed) {
    log.info(`[billing-webhook] Skipping duplicate event: ${event.id} (${event.type})`);
    return { received: true, eventType: event.type, duplicate: true };
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      // Capture confirmed by Stripe — sync the transaction row only. The
      // consultation is flipped to `charged` by settleConsultation together with
      // its charge + ledger rows; flipping it here without them would hide a
      // capture whose DB write failed from the retry sweep, and the expert would
      // never be credited.
      const pi = event.data.object;
      await db.transaction.updateMany({
        where: { stripePaymentIntentId: pi.id, status: { not: "refunded" } },
        data: { status: "succeeded" },
      });
      log.info(`[billing-webhook] payment_intent.succeeded PI=${pi.id}`);
      break;
    }

    case "payment_intent.payment_failed": {
      // Hold, overage, or direct charge declined. Never downgrade a consultation
      // that has already been settled (e.g. a declined overage after a capture).
      const pi = event.data.object;
      await db.transaction.updateMany({
        where: { stripePaymentIntentId: pi.id },
        data: { status: "failed" },
      });
      const consultationId = pi.metadata?.consultationId;
      if (consultationId) {
        await db.consultation.updateMany({
          where: { id: consultationId, billingStatus: "pending" },
          data: { billingStatus: "failed" },
        });
      }
      log.info(`[billing-webhook] payment_intent.payment_failed PI=${pi.id}`);
      break;
    }

    case "payment_intent.canceled": {
      // Hold released — by us, or expired by Stripe after ~7 days uncaptured.
      const pi = event.data.object;
      await db.consultation.updateMany({
        where: { stripePaymentIntentId: pi.id, holdReleasedAt: null },
        data: { holdReleasedAt: new Date() },
      });
      log.info(`[billing-webhook] payment_intent.canceled PI=${pi.id} reason=${pi.cancellation_reason ?? "-"}`);
      break;
    }

    case "account.updated": {
      // Expert Connect status. Payout readiness is checked live against Stripe
      // before every transfer; this log gives ops the history.
      const account = event.data.object;
      log.info(
        `[billing-webhook] account.updated ${account.id} transfers=${account.capabilities?.transfers ?? "-"} payouts_enabled=${account.payouts_enabled} due=${JSON.stringify(account.requirements?.currently_due ?? [])}`
      );
      break;
    }

    case "transfer.created": {
      // Payout transfer created on Stripe. runPayouts already sets the payout to
      // `paid` and stamps stripeTransferId optimistically; this reconciles the id
      // in case it was missing (e.g. the DB update after transfers.create failed).
      const transfer = event.data.object;
      // Match on the stored transfer id, or — when the DB write after the
      // transfer failed and no id was stored — on transfer_group PAYOUT_<id>.
      const payoutId = transfer.transfer_group?.startsWith("PAYOUT_")
        ? transfer.transfer_group.slice("PAYOUT_".length)
        : null;
      const updated = await db.expertPayout.updateMany({
        where: {
          status: { not: "paid" },
          OR: [
            { stripeTransferId: transfer.id },
            ...(payoutId ? [{ id: payoutId, stripeTransferId: null }] : []),
          ],
        },
        data: { status: "paid", stripeTransferId: transfer.id },
      });
      if (updated.count > 0) {
        log.info(`[billing-webhook] transfer.created reconciled payout for transfer=${transfer.id}`);
      }
      break;
    }

    case "transfer.reversed": {
      // A previously-created transfer was reversed (claw-back / destination could
      // not receive). The money has returned to the platform balance, so the payout
      // is no longer paid: mark it failed AND return its earnings to the unpaid pool
      // (unstamp payoutId) so the next runPayouts re-pays the expert. Keyed on the
      // Stripe transfer id.
      const transfer = event.data.object;
      const payout = await db.expertPayout.findFirst({
        where: { stripeTransferId: transfer.id },
      });
      if (!payout) {
        log.warn(`[billing-webhook] transfer.reversed for unknown transfer=${transfer.id} — no matching payout`);
        break;
      }
      if (payout.status === "failed") {
        log.info(`[billing-webhook] transfer.reversed payout=${payout.id} already failed — skipping`);
        break;
      }
      await db.$transaction(async (tx) => {
        await tx.expertPayout.update({
          where: { id: payout.id },
          data: { status: "failed" },
        });
        // Return the settled earnings to the unpaid pool for the next run.
        await tx.expertEarningsLedger.updateMany({
          where: { payoutId: payout.id },
          data: { payoutId: null },
        });
      });
      log.warn(`[billing-webhook] transfer.reversed payout=${payout.id} transfer=${transfer.id} — earnings returned to unpaid pool`);
      break;
    }

    case "payout.failed": {
      // A Connect account's own bank payout (Stripe → expert's bank) failed. This is
      // downstream of our transfer (funds already left the platform balance) and
      // Stripe retries it, so we do not unstamp earnings here — we only record it for
      // operator visibility. No payout row is keyed to this object; log and move on.
      const payout = event.data.object;
      log.error(`[billing-webhook] payout.failed stripePayoutId=${payout.id} amount=${payout.amount} — expert bank payout failed on Stripe`);
      break;
    }

    default:
      break;
  }

  // Record processed event for deduplication
  await db.processedWebhookEvent.create({
    data: { id: event.id, eventType: event.type },
  }).catch((err) => {
    // Non-fatal — if insert fails (e.g., duplicate from race), the event was still processed
    log.warn(`[billing-webhook] Failed to record processed event ${event.id}: ${err.message}`);
  });

  return { received: true, eventType: event.type };
}


export async function listTransactions(auth, query) {
  if (!auth.customerProfileId) throw forbidden("customerAccessRequired");
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();

  const where = {
    OR: [
      {
        consultationCharge: {
          consultation: {
            customerId: auth.customerProfileId,
          },
        },
      },
      {
        metadata: {
          path: ["customerProfileId"],
          equals: auth.customerProfileId,
        },
      },
    ],
  };

  const [rows, total] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        consultationCharge: {
          include: {
            consultation: {
              include: { 
                customer: { include: { avatarMedia: true } }, 
                expert: { include: { avatarMedia: true } }
              },
            },
          },
        },
      },
    }),
    db.transaction.count({ where }),
  ]);

  const items = rows.map((t) => toTransactionDto(t));
  return paginatedResult(items, { page, limit, total });
}

export async function getTransaction(auth, transactionId) {
  const db = getDb();
  const tx = await db.transaction.findUnique({
    where: { id: transactionId },
    include: {
      consultationCharge: {
        include: {
          consultation: {
            include: { customer: true, expert: true },
          },
        },
      },
    },
  });

  if (!tx) throw notFound("transactionNotFound");

  const consultation = tx.consultationCharge?.consultation;
  if (consultation) {
    // Consultation-linked transaction: check participant ownership
    const isCustomer = consultation.customerId === auth.customerProfileId;
    const isExpert = consultation.expertId === auth.expertProfileId;
    if (!isCustomer && !isExpert) throw forbidden("notFound");
  } else {
    // C7: Subscription / other transaction: check ownership via metadata
    // metadata is stored as { expertProfileId, customerProfileId, ... } at creation time
    const meta = tx.metadata ?? {};
    const ownerExpertId = meta.expertProfileId ?? null;
    const ownerCustomerId = meta.customerProfileId ?? null;

    const isOwner =
      (auth.expertProfileId && ownerExpertId === auth.expertProfileId) ||
      (auth.customerProfileId && ownerCustomerId === auth.customerProfileId);

    if (!isOwner) throw forbidden("notFound");
  }

  return toTransactionDto(tx);
}

/**
 * Internal-only: return the ConsultationCharge for a given consultation.
 * Called by engagement-service via the internal GET /consultations/:id/charge endpoint.
 * Returns null if no charge exists yet (pre-billing state).
 */
export async function getConsultationCharge(consultationId) {
  return getDb().consultationCharge.findUnique({
    where: { consultationId },
  });
}

export async function listSubscriptionPlans() {
  const plans = await getDb().subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { priceMonthlyCents: "asc" },
  });
  return plans.map((plan) => toSubscriptionPlanDto(plan));
}

/**
 * Legacy generic subscribe entry point (`POST /subscriptions`).
 *
 * DISABLED as an activation path. It previously minted an active subscription
 * from an unvalidated `receiptData` (`iap_stub_<uuid>`), which let any expert
 * grant themselves a paid plan for free — a revenue bypass. All real activations
 * MUST carry a verified store receipt, so this now hard-rejects and points the
 * caller at the store-specific verification endpoints:
 *   - Apple:  POST /api/v1/billing/subscriptions/verify/apple
 *   - Google: POST /api/v1/billing/subscriptions/verify/google
 *
 * Those controllers (appleIapController / googleIapController) do the full JWS/
 * receipt verification, replay protection, real expiry dates, plan reinstatement,
 * upgrade/downgrade, and search-eligibility flip.
 */
export async function subscribe() {
  throw badRequest("subscriptionRequiresStoreReceipt", "STORE_RECEIPT_REQUIRED");
}

export async function getMySubscription(auth) {
  // Includes subscriptions that are active OR scheduled to cancel at period end
  const subscription = await getDb().expertSubscription.findFirst({
    where: {
      expertProfileId: auth.expertProfileId,
      status: "active",
    },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });

  if (!subscription) throw notFound("noActiveSubscription");
  return toExpertSubscriptionDto(subscription, subscription.plan);
}

export async function getEarnings(auth, query) {
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();

  // ── Filters ────────────────────────────────────────────────────────────────
  // Supported query params:
  //   ?dateFrom=2026-01-01   — start of date range (inclusive, ISO date)
  //   ?dateTo=2026-12-31     — end of date range (inclusive, ISO date)
  //   ?status=PAID|PENDING   — filter by billing status
  //   ?q=Jane                — search by customer first/last name (case-insensitive)

  const where = { expertProfileId: auth.expertProfileId };

  if (query.dateFrom || query.dateTo) {
    where.createdAt = {};
    if (query.dateFrom) {
      where.createdAt.gte = new Date(query.dateFrom);
    }
    if (query.dateTo) {
      // Include the full day of dateTo by advancing to midnight of next day
      const to = new Date(query.dateTo);
      to.setDate(to.getDate() + 1);
      where.createdAt.lt = to;
    }
  }

  // status filter maps PAID → billingStatus=charged, PENDING → everything else
  if (query.status === "PAID") {
    where.consultation = { billingStatus: "charged" };
  } else if (query.status === "PENDING") {
    where.consultation = { billingStatus: { not: "charged" } };
  }

  // Customer name search — filter via the nested consultation→customer relation
  if (query.q && query.q.trim().length > 0) {
    const term = query.q.trim();
    // Merge with any existing consultation filter
    where.consultation = {
      ...(where.consultation ?? {}),
      customer: {
        OR: [
          { firstName: { contains: term, mode: "insensitive" } },
          { lastName: { contains: term, mode: "insensitive" } },
        ],
      },
    };
  }

  const [rows, total] = await Promise.all([
    db.expertEarningsLedger.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        consultation: {
          include: {
            customer: { include: { avatarMedia: true } },
          },
        },
        payout: { select: { status: true } },
      },
    }),
    db.expertEarningsLedger.count({ where }),
  ]);

  const expert = await db.expertProfile.findUnique({
    where: { id: auth.expertProfileId },
    select: { currency: true },
  });

  const items = rows.map((row) => toEarningsEntryDto(row, expert?.currency || "USD"));
  return paginatedResult(items, { page, limit, total });
}

export async function cancelSubscription(auth) {
  const db = getDb();
  const subscription = await db.expertSubscription.findFirst({
    where: { expertProfileId: auth.expertProfileId, status: "active" },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });

  if (!subscription) throw notFound("noActiveSubscriptionToCancel");

  // If already scheduled to cancel at period end, no-op
  if (subscription.cancelAtPeriodEnd) {
    return toExpertSubscriptionDto(subscription, subscription.plan);
  }

  // Mark as cancel-at-period-end — expert keeps access until currentPeriodEnd
  const updated = await db.expertSubscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: true },
    include: { plan: true },
  });

  // Notify expert of the cancellation schedule — non-fatal
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const periodEnd = updated.currentPeriodEnd
      ? new Date(updated.currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "the end of your billing period";
    await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
      userIds: [auth.userId],
      type: "subscription_cancelled",
      title: "Subscription Cancellation Scheduled",
      body: `Your ${updated.plan.name} subscription will be cancelled on ${periodEnd}. You retain access until then.`,
      data: { subscriptionId: updated.id, planId: updated.planId },
    });
  } catch (err) {
    log.error(`[cancelSubscription] Notification dispatch failed: ${err.message}`);
  }

  return toExpertSubscriptionDto(updated, updated.plan);
}

/**
 * Called by a scheduled cron job (e.g. nightly).
 * Finds all active subscriptions where cancelAtPeriodEnd=true AND currentPeriodEnd
 * has passed, then flips them to 'canceled'.
 */
export async function expireSubscriptions() {
  const db = getDb();
  const now = new Date();

  // Capture which experts are losing their subscription before we flip status,
  // so we can revoke search eligibility for any left without an active plan.
  const expiring = await db.expertSubscription.findMany({
    where: {
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lte: now },
    },
    select: { expertProfileId: true },
  });

  const result = await db.expertSubscription.updateMany({
    where: {
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lte: now },
    },
    data: {
      status: "canceled",
      canceledAt: now,
    },
  });

  // Revoke search eligibility for experts who no longer hold any active
  // subscription. Discoverability requires an active plan (mirrors the
  // approval-time rule and the activation path in subscribeToPlan).
  const affectedExpertIds = [...new Set(expiring.map((s) => s.expertProfileId))];
  for (const expertProfileId of affectedExpertIds) {
    const stillActive = await db.expertSubscription.findFirst({
      where: { expertProfileId, status: "active" },
      select: { id: true },
    });
    if (!stillActive) {
      await db.expertProfile.updateMany({
        where: { id: expertProfileId, searchEligible: true },
        data: { searchEligible: false },
      });
    }
  }

  log.info(`[billing] expireSubscriptions: expired ${result.count} subscription(s) at ${now.toISOString()}`);

  // Notify each affected expert that their subscription has expired — non-fatal
  if (affectedExpertIds.length > 0) {
    try {
      const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
      const db2 = getDb();
      const expertRows = await db2.expertProfile.findMany({
        where: { id: { in: affectedExpertIds } },
        select: { userId: true },
      });
      const userIds = expertRows.map((e) => e.userId).filter(Boolean);
      if (userIds.length > 0) {
        await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
          userIds,
          type: "subscription_expired",
          title: "Subscription Expired",
          body: "Your expert subscription has expired. Renew now to stay discoverable on XpertLink.",
          data: {},
        });
      }
    } catch (err) {
      log.error(`[expireSubscriptions] Notification dispatch failed: ${err.message}`);
    }
  }

  return { expired: result.count };
}

// ─────────────────────────────────────────────────────────────────────────────
// Durable settlement — failed-capture retry sweep
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retry consultations that completed but were never charged.
 *
 * The room_close → capture handoff is best-effort (fire-and-forget internal HTTP).
 * If billing was down, the network blipped, or a transient Stripe error left a
 * consultation at billingStatus="failed", nothing re-attempts it. This sweep finds
 * those stuck rows and re-invokes the SAME captureConsultation() path — which is
 * idempotent (it no-ops on already-charged rows), so re-running is always safe.
 *
 * Selection window:
 *   - status = completed, billingStatus in (pending, failed), durationSeconds > 0
 *   - endedAt older than graceMinutes (don't race a capture still in flight)
 *   - endedAt newer than maxAgeDays (stop retrying genuinely uncollectible calls;
 *     no-hold rows have no card to charge and would otherwise be scanned forever)
 *
 * @returns {Promise<{scanned:number, charged:number, stillFailed:number, skipped:number}>}
 */
export async function retryFailedCaptures({
  graceMinutes = Number(process.env.CAPTURE_RETRY_GRACE_MINUTES || 2),
  maxAgeDays = Number(process.env.CAPTURE_MAX_AGE_DAYS || 7),
  limit = Number(process.env.CAPTURE_RETRY_BATCH || 100),
} = {}) {
  const db = getDb();
  const now = Date.now();
  const graceCutoff = new Date(now - graceMinutes * 60 * 1000);
  const ageCutoff = new Date(now - maxAgeDays * 24 * 60 * 60 * 1000);

  const stuck = await db.consultation.findMany({
    where: {
      status: "completed",
      billingStatus: { in: ["pending", "failed"] },
      durationSeconds: { gt: 0 },
      endedAt: { lt: graceCutoff, gt: ageCutoff },
    },
    select: { id: true, durationSeconds: true },
    orderBy: { endedAt: "asc" },
    take: limit,
  });

  let charged = 0;
  let stillFailed = 0;
  let skipped = 0;

  for (const c of stuck) {
    try {
      const result = await captureConsultation(c.id, c.durationSeconds);
      if (result?.captured) charged += 1;
      else if (result?.skipped) skipped += 1;
      else stillFailed += 1;
    } catch (err) {
      stillFailed += 1;
      log.error(`[retryFailedCaptures] ${c.id} threw: ${err.message}`);
    }
  }

  log.info(
    `[retryFailedCaptures] scanned=${stuck.length} charged=${charged} stillFailed=${stillFailed} skipped=${skipped}`
  );
  return { scanned: stuck.length, charged, stillFailed, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Durable settlement — payouts
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Read the admin-configured payout cadence (integer days) from platform_settings.
 * Handles legacy enum strings ("weekly" etc.) and falls back to the default.
 */
export async function getPayoutScheduleDays() {
  const db = getDb();
  const row = await db.platformSetting.findUnique({ where: { key: "payoutSchedule" } });
  const value = row?.value;
  const legacyDays = { daily: 1, weekly: 7, monthly: 30 };
  if (typeof value === "string" && value in legacyDays) return legacyDays[value];
  const num = Number(value);
  return Number.isInteger(num) && num >= 1 ? num : PAYOUT_SCHEDULE_DEFAULT_DAYS;
}

/** 00:00 UTC of the day containing `date`. */
export function startOfUtcDay(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * An expert is due a scheduled payout when they have never been paid, or when
 * at least `days` whole days separate the day of their last payout from this
 * run's cut-off. A run is daily, so N=7 pays each expert once a week — counted
 * from their own last payout (manual or scheduled), not from a fixed weekday.
 */
export function isPayoutDue(lastPayoutAt, days, cutoff) {
  if (!lastPayoutAt) return true;
  return cutoff.getTime() - startOfUtcDay(lastPayoutAt).getTime() >= days * DAY_MS;
}

/**
 * Live Stripe readiness for sending `amountCents` to an expert.
 * @returns {Promise<{ready: boolean, reason: string|null, account: object|null}>}
 */
async function checkTransferReadiness(stripeAccountId) {
  if (!stripeAccountId) return { ready: false, reason: "no_connect_account", account: null };
  try {
    const account = await stripeSvc.getConnectAccountStatus(stripeAccountId);
    if (!account.transfersActive) return { ready: false, reason: "transfers_inactive", account };
    return { ready: true, reason: null, account };
  } catch (err) {
    log.error(`[payouts] Connect account ${stripeAccountId} lookup failed: ${err.message}`);
    return { ready: false, reason: "account_lookup_failed", account: null };
  }
}

/**
 * Create a `processing` payout and claim its ledger rows in one transaction.
 * Throws PAYOUT_CONFLICT (rolled back) if any row was claimed concurrently,
 * so the payout amount always equals the rows it owns.
 */
async function createPayoutForLedgerRows({ expertProfileId, currency, rows, periodEnd }) {
  const amountCents = rows.reduce((sum, r) => sum + r.netCents, 0);
  const periodStart = rows.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), rows[0].createdAt);
  return getDb().$transaction(async (tx) => {
    const created = await tx.expertPayout.create({
      data: { expertProfileId, amountCents, currency, periodStart, periodEnd, status: "processing" },
    });
    const claimed = await tx.expertEarningsLedger.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, payoutId: null },
      data: { payoutId: created.id },
    });
    if (claimed.count !== rows.length) throw conflict("payoutEarningsAlreadyClaimed", "PAYOUT_CONFLICT");
    return created;
  });
}

/**
 * Before re-sending a failed payout: if its transfer actually went out (the DB
 * write after it failed), mark it paid instead. Stripe's idempotency key only
 * lasts 24h, so without this a later retry would pay the expert twice.
 * Runs before readiness/balance checks — the balance that transfer used is gone.
 *
 * @returns {Promise<object|null>} the reconciled payout, or null to proceed
 */
async function reconcileSentTransfer(payout, logTag) {
  const existing = await stripeSvc.findTransferForPayout(payout.id);
  if (!existing || existing.reversed) return null;
  const updated = await getDb().expertPayout.update({
    where: { id: payout.id },
    data: { status: "paid", stripeTransferId: existing.id },
  });
  log.warn(`[${logTag}] payout ${payout.id} already transferred as ${existing.id} — reconciled, not re-sent`);
  return updated;
}

/**
 * Send (or re-send) the Stripe transfer for a payout. The idempotencyKey
 * `payout_<id>` makes a re-send return the original transfer instead of paying
 * twice. Flips the payout to `paid` or `failed` and notifies the expert.
 */
async function sendPayoutTransfer(payout, expert, logTag) {
  const db = getDb();
  try {
    const transfer = await stripeSvc.transferEarningsToExpertPayout({
      amountCents: payout.amountCents,
      currency: expert.currency || payout.currency || "usd",
      destinationStripeAccountId: expert.stripeAccountId,
      payoutId: payout.id,
    });
    const updated = await db.expertPayout.update({
      where: { id: payout.id },
      data: { status: "paid", stripeTransferId: transfer.id },
    });
    log.info(`[${logTag}] payout ${payout.id} → transfer ${transfer.id} $${(payout.amountCents / 100).toFixed(2)}`);

    if (expert.userId) {
      internalPost(NOTIFICATION_URL(), "/api/v1/notifications/dispatch", {
        userIds: [expert.userId],
        type: "payout_sent",
        title: "Payout Sent",
        body: `Your earnings payout of $${(payout.amountCents / 100).toFixed(2)} is on its way to your bank.`,
        data: { payoutId: payout.id, amountCents: payout.amountCents },
      }).catch((e) => log.error(`[${logTag}] payout notify failed: ${e.message}`));
    }
    return { ok: true, payout: updated, error: null };
  } catch (err) {
    // Ledger rows stay stamped so the amount is never doubled; the retry job
    // (or an admin retry) re-sends this same payout.
    const updated = await db.expertPayout.update({
      where: { id: payout.id },
      data: { status: "failed" },
    });
    log.error(`[${logTag}] transfer failed for payout ${payout.id}: ${err.message}`);
    return { ok: false, payout: updated, error: err.message };
  }
}

/** Per-run cache of available platform balance, decremented as payouts are sent. */
function createBalanceTracker() {
  const cache = new Map();
  return {
    async available(currency) {
      const cur = (currency || "usd").toLowerCase();
      if (!cache.has(cur)) {
        const { availableCents } = await stripeSvc.getAvailableBalanceCents(cur);
        cache.set(cur, availableCents);
      }
      return cache.get(cur);
    },
    spend(currency, cents) {
      const cur = (currency || "usd").toLowerCase();
      cache.set(cur, (cache.get(cur) ?? 0) - cents);
    },
  };
}

/**
 * Scheduled payout run (daily cron). For every expert with unpaid earnings
 * created before 00:00 UTC today, and who is due per the admin cadence
 * (`payoutSchedule`, N days since their last payout):
 *   - skip, leaving earnings unpaid for a later run, when the expert has no
 *     Connect account, Stripe transfers are not active, or the platform's
 *     available balance cannot cover the payout (card funds still settling);
 *   - otherwise aggregate ALL their unpaid rows into one ExpertPayout and send
 *     one Stripe Connect transfer.
 *
 * There is deliberately no lower date bound: earnings that could not be paid
 * earlier (no account yet, reversed transfer) are always picked up again.
 * Money is never recomputed — netCents was settled per call.
 */
export async function runPayouts({ now = new Date() } = {}) {
  const db = getDb();
  const days = await getPayoutScheduleDays();
  const cutoff = startOfUtcDay(now);

  const unpaid = await db.expertEarningsLedger.findMany({
    where: { payoutId: null, createdAt: { lt: cutoff } },
    select: { id: true, expertProfileId: true, netCents: true, createdAt: true },
  });

  const byExpert = new Map();
  for (const row of unpaid) {
    const rows = byExpert.get(row.expertProfileId) ?? [];
    rows.push(row);
    byExpert.set(row.expertProfileId, rows);
  }

  const summary = {
    scheduleDays: days,
    cutoff: cutoff.toISOString(),
    expertsConsidered: byExpert.size,
    payoutsCreated: 0,
    transfersSucceeded: 0,
    transfersFailed: 0,
    skippedNotDue: 0,
    skippedNoStripeAccount: 0,
    skippedTransfersInactive: 0,
    skippedInsufficientBalance: 0,
    skippedZero: 0,
    skippedDuplicate: 0,
    totalCents: 0,
  };
  const balance = createBalanceTracker();

  for (const [expertProfileId, rows] of byExpert) {
    const netCents = rows.reduce((sum, r) => sum + r.netCents, 0);
    if (netCents <= 0) {
      summary.skippedZero += 1;
      continue;
    }

    const [expert, lastPayout] = await Promise.all([
      db.expertProfile.findUnique({
        where: { id: expertProfileId },
        select: { stripeAccountId: true, currency: true, userId: true },
      }),
      db.expertPayout.findFirst({
        where: { expertProfileId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

    if (!isPayoutDue(lastPayout?.createdAt, days, cutoff)) {
      summary.skippedNotDue += 1;
      continue;
    }

    const readiness = await checkTransferReadiness(expert?.stripeAccountId);
    if (!readiness.ready) {
      if (readiness.reason === "no_connect_account") summary.skippedNoStripeAccount += 1;
      else summary.skippedTransfersInactive += 1;
      log.warn(
        `[runPayouts] expert ${expertProfileId} not payable (${readiness.reason}${readiness.account ? ` due=${JSON.stringify(readiness.account.requirementsDue)}` : ""}) — leaving ${netCents}¢ unpaid`
      );
      continue;
    }

    const currency = expert.currency || "USD";
    let availableCents;
    try {
      availableCents = await balance.available(currency);
    } catch (err) {
      log.error(`[runPayouts] balance lookup failed: ${err.message}`);
      availableCents = 0;
    }
    if (availableCents < netCents) {
      summary.skippedInsufficientBalance += 1;
      log.warn(
        `[runPayouts] expert ${expertProfileId} owed ${netCents}¢ but platform available balance is ${availableCents}¢ — leaving unpaid until funds settle`
      );
      continue;
    }

    let payout;
    try {
      payout = await createPayoutForLedgerRows({ expertProfileId, currency, rows, periodEnd: cutoff });
    } catch (err) {
      if (err?.code === "P2002" || err?.code === "PAYOUT_CONFLICT") {
        summary.skippedDuplicate += 1;
        log.info(`[runPayouts] expert ${expertProfileId} earnings already claimed by another payout — skipping`);
        continue;
      }
      throw err;
    }

    summary.payoutsCreated += 1;
    summary.totalCents += netCents;
    balance.spend(currency, netCents);

    const result = await sendPayoutTransfer(payout, expert, "runPayouts");
    if (result.ok) summary.transfersSucceeded += 1;
    else summary.transfersFailed += 1;
  }

  log.info(
    `[runPayouts] cutoff=${summary.cutoff} days=${days} created=${summary.payoutsCreated} paid=${summary.transfersSucceeded} failed=${summary.transfersFailed} notDue=${summary.skippedNotDue} noAcct=${summary.skippedNoStripeAccount} inactive=${summary.skippedTransfersInactive} lowBalance=${summary.skippedInsufficientBalance}`
  );
  return summary;
}

/**
 * Re-attempt the Stripe transfer for payouts left in `failed` status by a prior
 * run (transient Stripe/network errors). Without this, a failed transfer strands
 * the expert's earnings: its ledger rows stay stamped with the payout, so
 * `runPayouts()` (which only scans `payoutId: null`) never revisits them.
 *
 * Only payouts that STILL OWN ledger rows are retried. A payout reversed by the
 * `transfer.reversed` webhook has had its rows returned to the unpaid pool — they
 * are re-paid by a fresh payout, so retrying the old row would double-pay.
 *
 * Idempotent and safe on a schedule (payout-scoped Stripe idempotencyKey).
 */
export async function reattemptFailedPayouts({
  maxAgeDays = Number(process.env.PAYOUT_RETRY_MAX_AGE_DAYS || 14),
  limit = Number(process.env.PAYOUT_RETRY_BATCH || 100),
} = {}) {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeDays * DAY_MS);

  const failed = await db.expertPayout.findMany({
    where: {
      status: "failed",
      createdAt: { gte: cutoff },
      ledgerEntries: { some: {} },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const summary = {
    scanned: failed.length,
    recovered: 0,
    stillFailed: 0,
    skippedNoStripeAccount: 0,
    skippedTransfersInactive: 0,
    skippedInsufficientBalance: 0,
  };
  const balance = createBalanceTracker();

  for (const payout of failed) {
    try {
      if (await reconcileSentTransfer(payout, "reattemptFailedPayouts")) {
        summary.recovered += 1;
        continue;
      }
    } catch (err) {
      log.error(`[reattemptFailedPayouts] reconcile lookup for ${payout.id} failed: ${err.message}`);
      summary.stillFailed += 1;
      continue;
    }

    const expert = await db.expertProfile.findUnique({
      where: { id: payout.expertProfileId },
      select: { stripeAccountId: true, currency: true, userId: true },
    });

    const readiness = await checkTransferReadiness(expert?.stripeAccountId);
    if (!readiness.ready) {
      if (readiness.reason === "no_connect_account") summary.skippedNoStripeAccount += 1;
      else summary.skippedTransfersInactive += 1;
      continue;
    }

    let availableCents = 0;
    try {
      availableCents = await balance.available(expert.currency || payout.currency);
    } catch (err) {
      log.error(`[reattemptFailedPayouts] balance lookup failed: ${err.message}`);
    }
    if (availableCents < payout.amountCents) {
      summary.skippedInsufficientBalance += 1;
      continue;
    }

    const result = await sendPayoutTransfer(payout, expert, "reattemptFailedPayouts");
    if (result.ok) {
      summary.recovered += 1;
      balance.spend(expert.currency || payout.currency, payout.amountCents);
    } else {
      summary.stillFailed += 1;
    }
  }

  log.info(
    `[reattemptFailedPayouts] scanned=${summary.scanned} recovered=${summary.recovered} stillFailed=${summary.stillFailed} noAcct=${summary.skippedNoStripeAccount} inactive=${summary.skippedTransfersInactive} lowBalance=${summary.skippedInsufficientBalance}`
  );
  return summary;
}

// ── Admin payout operations (called by admin-service over internal HTTP) ─────

/**
 * Throw a 400 explaining why this expert cannot be paid right now, if so.
 */
async function assertPayable(expert, amountCents) {
  if (!expert.stripeAccountId) throw badRequest("expertPayoutAccountMissing", "NO_CONNECT_ACCOUNT");
  const readiness = await checkTransferReadiness(expert.stripeAccountId);
  if (!readiness.ready) {
    const due = readiness.account?.requirementsDue?.join(", ") || "-";
    throw badRequest("expertPayoutAccountNotReady", "CONNECT_NOT_READY", undefined, { requirements: due });
  }
  const { availableCents } = await stripeSvc.getAvailableBalanceCents(expert.currency || "usd");
  if (availableCents < amountCents) {
    throw badRequest("platformBalanceInsufficient", "INSUFFICIENT_BALANCE", undefined, {
      available: `$${(availableCents / 100).toFixed(2)}`,
      needed: `$${(amountCents / 100).toFixed(2)}`,
    });
  }
}

/**
 * Unpaid balance and payout readiness for one expert — drives the admin
 * "Pay out now" panel.
 */
export async function getExpertPayoutSummary(expertProfileId) {
  const db = getDb();
  const expert = await db.expertProfile.findUnique({
    where: { id: expertProfileId },
    select: { id: true, stripeAccountId: true, currency: true },
  });
  if (!expert) throw notFound("expertProfileNotFound");

  const [unpaid, lastPayout, days] = await Promise.all([
    db.expertEarningsLedger.aggregate({
      where: { expertProfileId, payoutId: null },
      _sum: { netCents: true },
      _count: { _all: true },
      _min: { createdAt: true },
    }),
    db.expertPayout.findFirst({ where: { expertProfileId }, orderBy: { createdAt: "desc" } }),
    getPayoutScheduleDays(),
  ]);

  const readiness = await checkTransferReadiness(expert.stripeAccountId);
  let platformAvailableCents = null;
  try {
    ({ availableCents: platformAvailableCents } = await stripeSvc.getAvailableBalanceCents(expert.currency || "usd"));
  } catch (err) {
    log.error(`[getExpertPayoutSummary] balance lookup failed: ${err.message}`);
  }

  const unpaidCents = unpaid._sum.netCents ?? 0;
  return {
    expertProfileId,
    currency: expert.currency || "USD",
    unpaidCents,
    unpaidEntries: unpaid._count._all,
    oldestUnpaidAt: unpaid._min.createdAt,
    lastPayout: lastPayout ? toExpertPayoutDto(lastPayout) : null,
    scheduleDays: days,
    hasConnectAccount: Boolean(expert.stripeAccountId),
    transfersActive: readiness.ready,
    payoutsEnabled: readiness.account?.payoutsEnabled ?? false,
    requirementsDue: readiness.account?.requirementsDue ?? [],
    platformAvailableCents,
    canPayNow:
      unpaidCents > 0 && readiness.ready && platformAvailableCents !== null && platformAvailableCents >= unpaidCents,
  };
}

/**
 * Admin "Pay out now": settle ALL of an expert's unpaid earnings immediately,
 * outside the schedule. Same claim + transfer path as the scheduled run.
 */
export async function payExpertNow(expertProfileId, { adminUserId } = {}) {
  const db = getDb();
  const expert = await db.expertProfile.findUnique({
    where: { id: expertProfileId },
    select: { stripeAccountId: true, currency: true, userId: true },
  });
  if (!expert) throw notFound("expertProfileNotFound");

  const rows = await db.expertEarningsLedger.findMany({
    where: { expertProfileId, payoutId: null },
    select: { id: true, netCents: true, createdAt: true },
  });
  const amountCents = rows.reduce((sum, r) => sum + r.netCents, 0);
  if (rows.length === 0 || amountCents <= 0) throw badRequest("noUnpaidEarnings", "NOTHING_TO_PAY");

  await assertPayable(expert, amountCents);

  let payout;
  try {
    payout = await createPayoutForLedgerRows({
      expertProfileId,
      currency: expert.currency || "USD",
      rows,
      periodEnd: new Date(),
    });
  } catch (err) {
    if (err?.code === "P2002" || err?.code === "PAYOUT_CONFLICT") {
      throw conflict("payoutEarningsAlreadyClaimed", "PAYOUT_CONFLICT");
    }
    throw err;
  }

  log.info(`[payExpertNow] admin ${adminUserId ?? "-"} paying expert ${expertProfileId} ${amountCents}¢ (payout ${payout.id})`);
  const result = await sendPayoutTransfer(payout, expert, "payExpertNow");
  return { payout: toExpertPayoutDto(result.payout), transferred: result.ok, error: result.error };
}

/**
 * Admin "Retry transfer" for one failed payout. Refuses payouts that no longer
 * own ledger rows (reversed — those earnings are re-paid by a fresh payout).
 */
export async function retryPayout(payoutId, { adminUserId } = {}) {
  const db = getDb();
  const payout = await db.expertPayout.findUnique({
    where: { id: payoutId },
    include: { _count: { select: { ledgerEntries: true } } },
  });
  if (!payout) throw notFound("payoutNotFound");
  if (payout.status !== "failed") throw badRequest("payoutNotRetryable", "INVALID_STATUS");
  if (payout._count.ledgerEntries === 0) throw badRequest("payoutReversedNotRetryable", "PAYOUT_REVERSED");

  const reconciled = await reconcileSentTransfer(payout, "retryPayout");
  if (reconciled) return { payout: toExpertPayoutDto(reconciled), transferred: true, error: null };

  const expert = await db.expertProfile.findUnique({
    where: { id: payout.expertProfileId },
    select: { stripeAccountId: true, currency: true, userId: true },
  });
  if (!expert) throw notFound("expertProfileNotFound");
  await assertPayable(expert, payout.amountCents);

  log.info(`[retryPayout] admin ${adminUserId ?? "-"} retrying payout ${payoutId}`);
  const result = await sendPayoutTransfer(payout, expert, "retryPayout");
  return { payout: toExpertPayoutDto(result.payout), transferred: result.ok, error: result.error };
}

/** The signed-in expert's payouts (money actually sent to their bank). */
export async function listMyPayouts(auth, query) {
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();
  const where = { expertProfileId: auth.expertProfileId };
  const [rows, total] = await Promise.all([
    db.expertPayout.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
    db.expertPayout.count({ where }),
  ]);
  return paginatedResult(rows.map(toExpertPayoutDto), { page, limit, total });
}
