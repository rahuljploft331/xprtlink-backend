import { getDb } from "@xprtlink/shared/db";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "billingService" });
import {
  toEarningsEntryDto,
  toExpertSubscriptionDto,
  toPaymentMethodDto,
  toSubscriptionPlanDto,
  toTransactionDto,
} from "@xprtlink/shared/mappers/billing.mapper.js";
import { badRequest, conflict, forbidden, notFound } from "@xprtlink/shared/utils/errors.js";
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
    try {
      const stripeCustomer = await stripeSvc.getOrCreateStripeCustomer({
        email: customerProfile.user.email,
        name: `${customerProfile.firstName} ${customerProfile.lastName}`,
      });
      stripeCustomerId = stripeCustomer.id;
      await db.customerProfile.update({
        where: { id: auth.customerProfileId },
        data: { stripeCustomerId },
      });
    } catch (err) {
      throw { statusCode: 502, code: "STRIPE_CUSTOMER_CREATION_FAILED", message: err.message };
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

  // Check if this stripe PM already exists for this customer (idempotency)
  const existing = await db.paymentMethod.findFirst({
    where: {
      customerProfileId: auth.customerProfileId,
      stripePaymentMethodId: body.stripePaymentMethodId,
    },
  });

  if (existing) {
    // Already stored — update default flag if needed and return it
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

  // Attempt to fetch real card metadata from Stripe (falls back to client-supplied values)
  let brand = body.brand;
  let last4 = body.last4;
  let expMonth = body.expMonth;
  let expYear = body.expYear;
  try {
    const pmDetails = await stripeSvc.retrievePaymentMethod({ stripePaymentMethodId: body.stripePaymentMethodId });
    if (pmDetails?.card) {
      brand = pmDetails.card.brand || brand;
      last4 = pmDetails.card.last4 || last4;
      expMonth = pmDetails.card.exp_month || expMonth;
      expYear = pmDetails.card.exp_year || expYear;
    }
  } catch (err) {
    // Non-fatal — use client-supplied values (test mode pm_card_* may not be retrievable)
    log.warn(`[billing] Stripe retrieve PM metadata failed (non-fatal): ${err.message}`);
  }

  const method = await db.paymentMethod.create({
    data: {
      customerProfileId: auth.customerProfileId,
      stripePaymentMethodId: body.stripePaymentMethodId,
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

export async function holdConsultationFunds(auth, consultationId, body) {
  const db = getDb();

  const consultation = await db.consultation.findFirst({
    where: { id: consultationId, customerId: auth.customerProfileId },
    include: { expert: true },
  });
  if (!consultation) throw notFound("consultationNotFound");
  if (consultation.billingStatus === "charged") throw conflict("consultationAlreadyPaid", "ALREADY_PAID");

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

  try {
    const holdResult = await stripeSvc.createPreAuthHold({
      customerStripeId: customerProfile.stripeCustomerId,
      stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
      amountCents: estimatedCents,
      currency: consultation.expert?.currency || "USD",
      metadata: { consultationId, customerProfileId: auth.customerProfileId },
      consultationId,
    });

    // Persist the PaymentIntent ID on the consultation so room_close can capture it
    await db.consultation.update({
      where: { id: consultationId },
      data: { stripePaymentIntentId: holdResult.id },
    });

    return {
      consultationId,
      holdStatus: holdResult.status,
      stripePaymentIntentId: holdResult.id,
      amountCents: estimatedCents,
      authorized: true,
    };
  } catch (err) {
    throw { statusCode: 502, code: "HOLD_FAILED", message: err.message };
  }
}

export async function payConsultation(auth, consultationId, body) {
  const db = getDb();

  const consultation = await db.consultation.findFirst({
    where: { id: consultationId, customerId: auth.customerProfileId },
    include: { expert: true, charge: true },
  });
  if (!consultation) throw notFound("consultationNotFound");
  if (consultation.status !== "completed") {
    throw badRequest("consultationMustBeCompletedBeforePayment", "INVALID_STATE");
  }
  if (consultation.billingStatus === "charged" || consultation.charge) {
    throw conflict("consultationAlreadyPaid", "ALREADY_PAID");
  }

  const paymentMethod = await db.paymentMethod.findFirst({
    where: { id: body.paymentMethodId, customerProfileId: auth.customerProfileId },
  });
  if (!paymentMethod) throw notFound("paymentMethodNotFound");

  const amountCents = computeConsultationChargeCents(consultation);
  if (amountCents <= 0) {
    throw badRequest("nothingToCharge", "INVALID_AMOUNT");
  }

  const currency = consultation.expert.currency || "USD";
  let stripeResult;

  try {
    if (body.stripePaymentIntentId) {
      // Capture held PaymentIntent with final computed amount
      stripeResult = await stripeSvc.capturePaymentIntent({
        paymentIntentId: body.stripePaymentIntentId,
        amountToCaptureCents: amountCents,
      });
    } else {
      // Direct charge — no prior hold
      const customerProfile = await db.customerProfile.findUnique({
        where: { id: auth.customerProfileId },
      });
      stripeResult = await stripeSvc.createAndConfirmPaymentIntent({
        customerStripeId: customerProfile.stripeCustomerId,
        stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
        amountCents,
        currency,
        metadata: { consultationId },
        consultationId,
      });
    }
  } catch (err) {
    throw { statusCode: 502, code: "CAPTURE_FAILED", message: err.message };
  }

  // Fetch dynamic commission rate
  const commissionSetting = await db.platformSetting.findUnique({ where: { key: "commissionPercent" } });
  let rate = 0.15;
  if (commissionSetting && typeof commissionSetting.value === "number") {
    rate = commissionSetting.value / 100;
  }
  
  // Record transaction
  const commissionCents = computeConsultationCommissionCents(amountCents, rate);
  const expertShareCents = amountCents - commissionCents;

  const result = await db.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: {
        type: "consultation_charge",
        amountCents,
        currency,
        status: "succeeded",
        stripePaymentIntentId: stripeResult.id,
        metadata: {
          consultationId,
          paymentMethodId: paymentMethod.id,
          customerProfileId: auth.customerProfileId,
        },
      },
    });

    await tx.consultationCharge.create({
      data: {
        consultationId,
        transactionId: transaction.id,
        commissionCents,
        expertShareCents,
      },
    });

    await tx.expertEarningsLedger.create({
      data: {
        expertProfileId: consultation.expertId,
        consultationId,
        grossCents: amountCents,
        commissionCents,
        netCents: expertShareCents,
      },
    });

    await tx.consultation.update({
      where: { id: consultationId },
      data: { billingStatus: "charged" },
    });

    return transaction;
  });

  return toTransactionDto(result);
}

/**
 * Internal service-to-service capture — called by engagement-service on room_close.
 * No customer auth required. Uses the stripePaymentIntentId stored on the consultation.
 *
 * If no hold was placed (customer had no card), marks billing as failed gracefully.
 */
export async function captureConsultation(consultationId, durationSeconds) {
  const db = getDb();

  const consultation = await db.consultation.findUnique({
    where: { id: consultationId },
    include: { expert: true, charge: true },
  });

  if (!consultation) {
    log.warn(`[billing] captureConsultation: consultation ${consultationId} not found`);
    return { skipped: true, reason: "not_found" };
  }

  if (consultation.billingStatus === "charged" || consultation.charge) {
    log.info(`[billing] captureConsultation: ${consultationId} already charged — skipping`);
    return { skipped: true, reason: "already_charged" };
  }

  // Same helper as payConsultation — the two paths must never round differently.
  const amountCents = computeConsultationChargeCents(consultation, durationSeconds);

  if (amountCents <= 0) {
    log.info(`[billing] captureConsultation: ${consultationId} — zero amount, skipping charge`);
    return { skipped: true, reason: "zero_amount" };
  }

  const commissionSetting = await db.platformSetting.findUnique({ where: { key: "commissionPercent" } });
  let rate = 0.15;
  if (commissionSetting && typeof commissionSetting.value === "number") {
    rate = commissionSetting.value / 100;
  }
  const commissionCents = computeConsultationCommissionCents(amountCents, rate);
  const expertShareCents = amountCents - commissionCents;
  const currency = consultation.expert?.currency || "USD";

  let stripeResult = null;

  if (consultation.stripePaymentIntentId) {
    // Happy path — customer placed a hold before the call
    try {
      stripeResult = await stripeSvc.capturePaymentIntent({
        paymentIntentId: consultation.stripePaymentIntentId,
        amountToCaptureCents: amountCents,
      });
      log.info(`[billing] captureConsultation: captured PI=${stripeResult.id} amount=${amountCents}¢`);
    } catch (err) {
      log.error(`[billing] captureConsultation: Stripe capture failed — ${err.message}`);
      await db.consultation.update({
        where: { id: consultationId },
        data: { billingStatus: "failed" },
      });

      // Notify customer that payment failed — non-fatal
      try {
        const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
        const db2 = getDb();
        const custForNotif = await db2.consultation.findUnique({
          where: { id: consultationId },
          include: { customer: { include: { user: true } } },
        });
        if (custForNotif?.customer?.user?.id) {
          await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
            userIds: [custForNotif.customer.user.id],
            type: "payment_failed",
            title: "Payment Failed",
            body: "We were unable to process your consultation payment. Please check your payment method and try again.",
            data: { consultationId },
          });
        }
      } catch (notifErr) {
        log.error(`[captureConsultation] Failure notification failed: ${notifErr.message}`);
      }

      return { skipped: false, captured: false, reason: "stripe_capture_failed", error: err.message };
    }
  } else {
    // No hold placed — customer had no payment method on file
    log.warn(`[billing] captureConsultation: ${consultationId} has no stripePaymentIntentId — marking failed`);
    await db.consultation.update({
      where: { id: consultationId },
      data: { billingStatus: "failed" },
    });
    return { skipped: false, captured: false, reason: "no_hold" };
  }

  // Record billing in a transaction
  const result = await db.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: {
        type: "consultation_charge",
        amountCents,
        currency,
        status: "succeeded",
        stripePaymentIntentId: stripeResult.id,
        metadata: { consultationId, source: "room_close" },
      },
    });

    await tx.consultationCharge.create({
      data: {
        consultationId,
        transactionId: transaction.id,
        commissionCents,
        expertShareCents,
      },
    });

    await tx.expertEarningsLedger.create({
      data: {
        expertProfileId: consultation.expertId,
        consultationId,
        grossCents: amountCents,
        commissionCents,
        netCents: expertShareCents,
      },
    });

    await tx.consultation.update({
      where: { id: consultationId },
      data: { billingStatus: "charged" },
    });

    return transaction;
  });

  log.info(`[billing] captureConsultation: ${consultationId} → charged $${(amountCents / 100).toFixed(2)}`);

  // Notify customer (charge confirmation) and expert (earnings credit) — non-fatal.
  // Also email a soft-copy invoice to each party (customer=debit, expert=credit).
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const db2 = getDb();
    const consultationForNotif = await db2.consultation.findUnique({
      where: { id: consultationId },
      include: {
        customer: { include: { user: true } },
        expert: { include: { user: true } },
      },
    });
    const notifUserIds = [
      consultationForNotif?.customer?.user?.id,
      consultationForNotif?.expert?.userId,
    ].filter(Boolean);
    if (notifUserIds.length > 0) {
      const amountFormatted = `$${(amountCents / 100).toFixed(2)}`;
      await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: notifUserIds,
        type: "payment_succeeded",
        title: "Payment Successful",
        body: `Consultation payment of ${amountFormatted} was processed successfully.`,
        data: { consultationId, amountCents, transactionId: result.id },
      });
    }

    // Fire invoice emails off the response path — SendGrid latency must never
    // block or roll back a successful capture (no queue infra in this codebase,
    // so this follows the established fire-and-forget + .catch() pattern).
    sendConsultationInvoices({
      consultation: consultationForNotif,
      amountCents,
      commissionCents,
      expertShareCents,
      currency,
    }).catch((err) => {
      log.error(`[captureConsultation] Invoice email dispatch failed: ${err.message}`);
    });
  } catch (err) {
    log.error(`[captureConsultation] Payment notification failed: ${err.message}`);
  }

  return { captured: true, transactionId: result.id, amountCents, commissionCents, expertShareCents };
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

  // Call Stripe Custom Account creation API
  const account = await stripeSvc.createCustomConnectAccount({
    expertEmail: expert.user.email,
    firstName: body.firstName,
    lastName: body.lastName,
    dob: body.dob,
    address: body.address,
    ssnLast4: body.ssnLast4,
    frontDocumentFileId: body.frontDocumentFileId,
    backDocumentFileId: body.backDocumentFileId,
    userIpAddress: body.userIpAddress,
  });

  // Persist the Stripe Connect account ID so attachBankAccount can reference it
  await db.expertProfile.update({
    where: { id: auth.expertProfileId },
    data: { stripeAccountId: account.id },
  });

  return {
    expertProfileId: auth.expertProfileId,
    stripeAccountId: account.id,
    kycStatus: "submitted",
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
      // Final capture confirmed by Stripe — sync transaction status
      const pi = event.data.object;
      await db.transaction.updateMany({
        where: { stripePaymentIntentId: pi.id },
        data: { status: "succeeded" },
      });
      const consultationId = pi.metadata?.consultationId;
      if (consultationId) {
        await db.consultation.updateMany({
          where: { id: consultationId },
          data: { billingStatus: "charged" },
        });
      }
      log.info(`[billing-webhook] payment_intent.succeeded PI=${pi.id}`);
      break;
    }

    case "payment_intent.payment_failed": {
      // Pre-auth or capture failed — mark as failed
      const pi = event.data.object;
      await db.transaction.updateMany({
        where: { stripePaymentIntentId: pi.id },
        data: { status: "failed" },
      });
      const consultationId = pi.metadata?.consultationId;
      if (consultationId) {
        await db.consultation.updateMany({
          where: { id: consultationId },
          data: { billingStatus: "failed" },
        });
      }
      log.info(`[billing-webhook] payment_intent.payment_failed PI=${pi.id}`);
      break;
    }

    case "account.updated":
      // Expert Connect KYC status update — handle KYC approval/rejection here later
      break;

    case "transfer.created": {
      // Payout transfer created on Stripe. runPayouts already sets the payout to
      // `paid` and stamps stripeTransferId optimistically; this reconciles the id
      // in case it was missing (e.g. the DB update after transfers.create failed).
      const transfer = event.data.object;
      const updated = await db.expertPayout.updateMany({
        where: { stripeTransferId: transfer.id, status: { not: "paid" } },
        data: { status: "paid" },
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
// Durable settlement — payout-run job
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Compute the rolling settlement window for a run.
 * periodEnd = start of today (UTC 00:00); periodStart = periodEnd - N days.
 * A run on any given day settles the N days that ended at last midnight.
 */
export function computePayoutWindow(days, now = new Date()) {
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);
  return { periodStart, periodEnd };
}

/**
 * Payout-run job. For each expert with unpaid earnings in the current window,
 * aggregate their ExpertEarningsLedger rows (payoutId=null) into one ExpertPayout
 * and initiate a Stripe Connect transfer (Stripe is the source of truth).
 *
 * Money is NOT recomputed here — netCents was already settled per-call. This is
 * pure aggregation + transfer.
 *
 * Idempotency is triple-guarded:
 *   1. @@unique(expertProfileId, periodStart, periodEnd) on ExpertPayout (P2002 → skip)
 *   2. the `payoutId: null` guard in the ledger updateMany (never re-claims a row)
 *   3. the create+stamp is one $transaction; the Stripe transfer uses a
 *      payout-scoped idempotencyKey so a retried run can't double-send.
 *
 * Experts without a stripeAccountId (Connect/KYC incomplete) are skipped; their
 * earnings stay unpaid and roll into a later run.
 *
 * @returns {Promise<object>} run summary
 */
export async function runPayouts({ now = new Date() } = {}) {
  const db = getDb();
  const days = await getPayoutScheduleDays();
  const { periodStart, periodEnd } = computePayoutWindow(days, now);

  // Unpaid, in-window ledger rows grouped by expert.
  const unpaid = await db.expertEarningsLedger.findMany({
    where: {
      payoutId: null,
      createdAt: { gte: periodStart, lt: periodEnd },
    },
    select: { id: true, expertProfileId: true, netCents: true },
  });

  // Group ledger rows + sum net per expert.
  const byExpert = new Map();
  for (const row of unpaid) {
    const g = byExpert.get(row.expertProfileId) ?? { ids: [], netCents: 0 };
    g.ids.push(row.id);
    g.netCents += row.netCents;
    byExpert.set(row.expertProfileId, g);
  }

  const summary = {
    scheduleDays: days,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    expertsConsidered: byExpert.size,
    payoutsCreated: 0,
    transfersSucceeded: 0,
    transfersFailed: 0,
    skippedNoStripeAccount: 0,
    skippedZero: 0,
    skippedDuplicate: 0,
    totalCents: 0,
  };

  for (const [expertProfileId, group] of byExpert) {
    if (group.netCents <= 0) {
      summary.skippedZero += 1;
      continue;
    }

    const expert = await db.expertProfile.findUnique({
      where: { id: expertProfileId },
      select: { stripeAccountId: true, currency: true, userId: true },
    });

    if (!expert?.stripeAccountId) {
      // Connect/KYC not complete — leave earnings unpaid for a later run.
      summary.skippedNoStripeAccount += 1;
      log.warn(`[runPayouts] expert ${expertProfileId} has no stripeAccountId — skipping ${group.netCents}¢`);
      continue;
    }

    // 1. Create the payout + claim ledger rows in one transaction (status=processing).
    let payout;
    try {
      payout = await db.$transaction(async (tx) => {
        const created = await tx.expertPayout.create({
          data: {
            expertProfileId,
            amountCents: group.netCents,
            currency: expert.currency || "USD",
            periodStart,
            periodEnd,
            status: "processing",
          },
        });
        // Only claim rows still unpaid — guards against an overlapping run.
        await tx.expertEarningsLedger.updateMany({
          where: { id: { in: group.ids }, payoutId: null },
          data: { payoutId: created.id },
        });
        return created;
      });
    } catch (err) {
      // P2002 = unique violation on (expert, periodStart, periodEnd): already run for this window.
      if (err?.code === "P2002") {
        summary.skippedDuplicate += 1;
        log.info(`[runPayouts] payout already exists for expert ${expertProfileId} in window — skipping`);
        continue;
      }
      throw err;
    }

    summary.payoutsCreated += 1;
    summary.totalCents += group.netCents;

    // 2. Initiate the Stripe Connect transfer (source of truth).
    try {
      const transfer = await stripeSvc.transferEarningsToExpertPayout({
        amountCents: group.netCents,
        currency: expert.currency || "usd",
        destinationStripeAccountId: expert.stripeAccountId,
        payoutId: payout.id,
      });
      await db.expertPayout.update({
        where: { id: payout.id },
        data: { status: "paid", stripeTransferId: transfer.id },
      });
      summary.transfersSucceeded += 1;
      log.info(`[runPayouts] expert ${expertProfileId} → transfer ${transfer.id} $${(group.netCents / 100).toFixed(2)}`);

      // Notify the expert their payout was sent — non-fatal.
      if (expert.userId) {
        const amountFormatted = `$${(group.netCents / 100).toFixed(2)}`;
        internalPost(process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007", "/api/v1/notifications/dispatch", {
          userIds: [expert.userId],
          type: "payout_sent",
          title: "Payout Sent",
          body: `Your earnings payout of ${amountFormatted} is on its way to your bank.`,
          data: { payoutId: payout.id, amountCents: group.netCents },
        }).catch((e) => log.error(`[runPayouts] payout notify failed: ${e.message}`));
      }
    } catch (err) {
      // Transfer failed. Mark payout failed; ledger rows stay stamped so we never
      // double the amount. `reattemptFailedPayouts()` re-attempts the transfer for
      // failed payouts by id — the Stripe idempotencyKey (`payout_<id>`) makes the
      // retry safe even if the original transfer actually succeeded. Do NOT unstamp here.
      summary.transfersFailed += 1;
      await db.expertPayout.update({
        where: { id: payout.id },
        data: { status: "failed" },
      });
      log.error(`[runPayouts] transfer failed for expert ${expertProfileId} payout ${payout.id}: ${err.message}`);
    }
  }

  log.info(
    `[runPayouts] window=${summary.periodStart}..${summary.periodEnd} created=${summary.payoutsCreated} paid=${summary.transfersSucceeded} failed=${summary.transfersFailed} noAcct=${summary.skippedNoStripeAccount}`
  );
  return summary;
}

/**
 * Re-attempt the Stripe transfer for payouts left in `failed` status by a prior
 * `runPayouts()` (transient Stripe/network errors). Without this, a failed transfer
 * strands the expert's earnings permanently: the payout row is `failed` and its
 * ledger rows are already stamped with `payoutId`, so `runPayouts()` (which only
 * scans `payoutId: null`) never revisits them.
 *
 * Safety: the transfer uses the payout-scoped idempotencyKey `payout_<id>`, so if the
 * original transfer actually went through, Stripe returns that same transfer rather
 * than sending a second one — this can never double-pay. Ledger rows are left stamped
 * throughout; only the payout row's status (and stripeTransferId) changes.
 *
 * Idempotent and safe to run on a schedule.
 *
 * @param {{ maxAgeDays?: number, limit?: number }} [opts]
 * @returns {Promise<{scanned:number, recovered:number, stillFailed:number, skippedNoStripeAccount:number}>}
 */
export async function reattemptFailedPayouts({
  maxAgeDays = Number(process.env.PAYOUT_RETRY_MAX_AGE_DAYS || 14),
  limit = Number(process.env.PAYOUT_RETRY_BATCH || 100),
} = {}) {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  // Only retry payouts that STILL OWN their ledger rows. A payout whose transfer
  // merely failed at creation keeps its rows stamped (payoutId set) — safe to retry.
  // A payout that was later REVERSED (transfer.reversed webhook) has had its rows
  // returned to the unpaid pool (payoutId: null); those earnings are re-paid via a
  // fresh payout on the next runPayouts, so retrying this row here would double-pay.
  // The presence of ledgerEntries is the discriminator.
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
  };

  for (const payout of failed) {
    const expert = await db.expertProfile.findUnique({
      where: { id: payout.expertProfileId },
      select: { stripeAccountId: true, currency: true, userId: true },
    });

    if (!expert?.stripeAccountId) {
      // Still no Connect account — cannot transfer. Leave failed for a later run.
      summary.skippedNoStripeAccount += 1;
      log.warn(`[reattemptFailedPayouts] payout ${payout.id} expert ${payout.expertProfileId} has no stripeAccountId — skipping`);
      continue;
    }

    try {
      const transfer = await stripeSvc.transferEarningsToExpertPayout({
        amountCents: payout.amountCents,
        currency: expert.currency || payout.currency || "usd",
        destinationStripeAccountId: expert.stripeAccountId,
        payoutId: payout.id,
      });
      await db.expertPayout.update({
        where: { id: payout.id },
        data: { status: "paid", stripeTransferId: transfer.id },
      });
      summary.recovered += 1;
      log.info(`[reattemptFailedPayouts] recovered payout ${payout.id} → transfer ${transfer.id} $${(payout.amountCents / 100).toFixed(2)}`);

      // Notify the expert their payout was sent — non-fatal.
      if (expert.userId) {
        const amountFormatted = `$${(payout.amountCents / 100).toFixed(2)}`;
        internalPost(process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007", "/api/v1/notifications/dispatch", {
          userIds: [expert.userId],
          type: "payout_sent",
          title: "Payout Sent",
          body: `Your earnings payout of ${amountFormatted} is on its way to your bank.`,
          data: { payoutId: payout.id, amountCents: payout.amountCents },
        }).catch((e) => log.error(`[reattemptFailedPayouts] payout notify failed: ${e.message}`));
      }
    } catch (err) {
      summary.stillFailed += 1;
      log.error(`[reattemptFailedPayouts] retry failed for payout ${payout.id}: ${err.message}`);
    }
  }

  log.info(
    `[reattemptFailedPayouts] scanned=${summary.scanned} recovered=${summary.recovered} stillFailed=${summary.stillFailed} noAcct=${summary.skippedNoStripeAccount}`
  );
  return summary;
}
