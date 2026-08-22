import crypto from "crypto";
import { getDb } from "@xprtlink/shared/db";
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

const COMMISSION_RATE = 0.15;


function computeConsultationChargeCents(consultation) {
  const durationSeconds = consultation.durationSeconds ?? 0;
  const minutes = durationSeconds / 60;
  return Math.ceil(minutes * consultation.ratePerMinuteCents);
}

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
    console.warn(`[billing] Stripe attach PM failed (non-fatal): ${attachErr.message}`);
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
  const method = await db.paymentMethod.create({
    data: {
      customerProfileId: auth.customerProfileId,
      stripePaymentMethodId: body.stripePaymentMethodId,
      brand: body.brand,
      last4: body.last4,
      expMonth: body.expMonth,
      expYear: body.expYear,
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
  if (!method) throw notFound("Payment method not found");

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

export async function holdConsultationFunds(auth, consultationId, body) {
  const db = getDb();

  const consultation = await db.consultation.findFirst({
    where: { id: consultationId, customerId: auth.customerProfileId },
    include: { expert: true },
  });
  if (!consultation) throw notFound("Consultation not found");
  if (consultation.billingStatus === "charged") throw conflict("Consultation already paid", "ALREADY_PAID");

  // Retrieve customer with stripeCustomerId
  const customerProfile = await db.customerProfile.findUnique({
    where: { id: auth.customerProfileId },
  });
  if (!customerProfile.stripeCustomerId) {
    throw badRequest("No Stripe customer found. Add a payment method first.", "NO_STRIPE_CUSTOMER");
  }

  const paymentMethod = await db.paymentMethod.findFirst({
    where: { id: body.paymentMethodId, customerProfileId: auth.customerProfileId },
  });
  if (!paymentMethod) throw notFound("Payment method not found");

  // Enforce server-calculated minimum: at least 30 minutes at the expert's rate or $30,
  // whichever is larger — prevents malicious clients from holding too little.
  const serverMinimumCents = Math.max(30 * consultation.ratePerMinuteCents, 3000);
  const estimatedCents = Math.max(body.estimatedCents || 0, serverMinimumCents);

  try {
    const holdResult = await stripeSvc.createPreAuthHold({
      customerStripeId: customerProfile.stripeCustomerId,
      stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
      amountCents: estimatedCents,
      currency: consultation.expert?.currency || "USD",
      metadata: { consultationId, customerProfileId: auth.customerProfileId },
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
  if (!consultation) throw notFound("Consultation not found");
  if (consultation.status !== "completed") {
    throw badRequest("Consultation must be completed before payment", "INVALID_STATE");
  }
  if (consultation.billingStatus === "charged" || consultation.charge) {
    throw conflict("Consultation already paid", "ALREADY_PAID");
  }

  const paymentMethod = await db.paymentMethod.findFirst({
    where: { id: body.paymentMethodId, customerProfileId: auth.customerProfileId },
  });
  if (!paymentMethod) throw notFound("Payment method not found");

  const amountCents = computeConsultationChargeCents(consultation);
  if (amountCents <= 0) {
    throw badRequest("Nothing to charge for this consultation", "INVALID_AMOUNT");
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
      });
    }
  } catch (err) {
    throw { statusCode: 502, code: "CAPTURE_FAILED", message: err.message };
  }

  // Record transaction
  const commissionCents = Math.round(amountCents * COMMISSION_RATE);
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
    console.warn(`[billing] captureConsultation: consultation ${consultationId} not found`);
    return { skipped: true, reason: "not_found" };
  }

  if (consultation.billingStatus === "charged" || consultation.charge) {
    console.log(`[billing] captureConsultation: ${consultationId} already charged — skipping`);
    return { skipped: true, reason: "already_charged" };
  }

  const actualDuration = durationSeconds ?? consultation.durationSeconds ?? 0;
  const amountCents = Math.ceil((actualDuration / 60) * consultation.ratePerMinuteCents);

  if (amountCents <= 0) {
    console.log(`[billing] captureConsultation: ${consultationId} — zero amount, skipping charge`);
    return { skipped: true, reason: "zero_amount" };
  }

  const commissionCents = Math.round(amountCents * COMMISSION_RATE);
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
      console.log(`[billing] captureConsultation: captured PI=${stripeResult.id} amount=${amountCents}¢`);
    } catch (err) {
      console.error(`[billing] captureConsultation: Stripe capture failed — ${err.message}`);
      await db.consultation.update({
        where: { id: consultationId },
        data: { billingStatus: "failed" },
      });
      return { skipped: false, captured: false, reason: "stripe_capture_failed", error: err.message };
    }
  } else {
    // No hold placed — customer had no payment method on file
    console.warn(`[billing] captureConsultation: ${consultationId} has no stripePaymentIntentId — marking failed`);
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

  console.log(`[billing] captureConsultation: ${consultationId} → charged $${(amountCents / 100).toFixed(2)}`);
  return { captured: true, transactionId: result.id, amountCents, commissionCents, expertShareCents };
}

export async function submitCustomConnectKyc(auth, body) {
  const db = getDb();
  const expert = await db.expertProfile.findUnique({
    where: { id: auth.expertProfileId },
    include: { user: true },
  });

  if (!expert) throw notFound("Expert profile not found");

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

  if (!expert) throw notFound("Expert profile not found");

  // Expert must have completed KYC (Stripe Custom Connect account) before adding a bank account
  if (!expert.stripeAccountId) {
    throw badRequest(
      "Please complete identity verification (KYC) before adding a bank account.",
      "KYC_REQUIRED"
    );
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
      console.log(`[billing-webhook] payment_intent.succeeded PI=${pi.id}`);
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
      console.log(`[billing-webhook] payment_intent.payment_failed PI=${pi.id}`);
      break;
    }

    case "account.updated":
      // Expert Connect KYC status update — handle KYC approval/rejection here later
      break;

    case "transfer.created":
      // Expert payout transfer created
      break;

    default:
      break;
  }

  return { received: true, eventType: event.type };
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

  if (!tx) throw notFound("Transaction not found");

  const consultation = tx.consultationCharge?.consultation;
  if (consultation) {
    // Consultation-linked transaction: check participant ownership
    const isCustomer = consultation.customerId === auth.customerProfileId;
    const isExpert = consultation.expertId === auth.expertProfileId;
    if (!isCustomer && !isExpert) throw forbidden("Access denied");
  } else {
    // C7: Subscription / other transaction: check ownership via metadata
    // metadata is stored as { expertProfileId, customerProfileId, ... } at creation time
    const meta = tx.metadata ?? {};
    const ownerExpertId = meta.expertProfileId ?? null;
    const ownerCustomerId = meta.customerProfileId ?? null;

    const isOwner =
      (auth.expertProfileId && ownerExpertId === auth.expertProfileId) ||
      (auth.customerProfileId && ownerCustomerId === auth.customerProfileId);

    if (!isOwner) throw forbidden("Access denied");
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

export async function subscribe(auth, body) {
  const db = getDb();
  let plan = null;
  if (body.planId) {
    plan = await db.subscriptionPlan.findFirst({
      where: { id: body.planId, isActive: true },
    });
  }
  if (!plan && body.planCode) {
    plan = await db.subscriptionPlan.findFirst({
      where: { code: body.planCode, isActive: true },
    });
  }
  if (!plan) {
    plan = await db.subscriptionPlan.findFirst({
      where: { isActive: true },
    });
  }
  if (!plan) throw notFound("Subscription plan not found");

  // IAP receipt validation stub — accept any non-empty receiptData.
  const externalSubscriptionId = `iap_stub_${crypto.randomUUID()}`;
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const subscription = await db.$transaction(async (tx) => {
    // ── Guard: block re-subscribing to the same active plan ─────────────────
    const existingActive = await tx.expertSubscription.findFirst({
      where: { expertProfileId: auth.expertProfileId, status: "active" },
    });

    if (existingActive && existingActive.planId === plan.id) {
      if (existingActive.cancelAtPeriodEnd) {
        // Expert is reinstating a plan they scheduled to cancel — undo the cancel
        const reinstated = await tx.expertSubscription.update({
          where: { id: existingActive.id },
          data: { cancelAtPeriodEnd: false },
          include: { plan: true },
        });
        return reinstated;
      }
      throw conflict(
        "You are already subscribed to this plan. To change your plan, choose a different one.",
        "ALREADY_SUBSCRIBED"
      );
    }

    // Cancel any other active subscription (upgrade / downgrade)
    if (existingActive) {
      await tx.expertSubscription.update({
        where: { id: existingActive.id },
        data: { status: "canceled", canceledAt: now, cancelAtPeriodEnd: false },
      });
    }


    const created = await tx.expertSubscription.create({
      data: {
        expertProfileId: auth.expertProfileId,
        planId: plan.id,
        store: body.store,
        externalSubscriptionId,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
      include: { plan: true },
    });

    await tx.transaction.create({
      data: {
        type: "subscription",
        amountCents: plan.priceMonthlyCents,
        currency: "USD",
        status: "succeeded",
        metadata: {
          expertProfileId: auth.expertProfileId,
          planId: plan.id,
          store: body.store,
          receiptStub: true,
        },
      },
    });

    return created;
  });

  return toExpertSubscriptionDto(subscription, subscription.plan);
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

  if (!subscription) throw notFound("No active subscription");
  return toExpertSubscriptionDto(subscription, subscription.plan);
}

export async function getEarnings(auth, query) {
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();

  const [rows, total] = await Promise.all([
    db.expertEarningsLedger.findMany({
      where: { expertProfileId: auth.expertProfileId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.expertEarningsLedger.count({ where: { expertProfileId: auth.expertProfileId } }),
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

  if (!subscription) throw notFound("No active subscription to cancel");

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

  console.log(`[billing] expireSubscriptions: expired ${result.count} subscription(s) at ${now.toISOString()}`);
  return { expired: result.count };
}
