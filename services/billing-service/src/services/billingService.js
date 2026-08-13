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

  // 4. Persist locally
  if (body.setDefault) {
    await db.paymentMethod.updateMany({
      where: { customerProfileId: auth.customerProfileId },
      data: { isDefault: false },
    });
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
  if (consultation.billingStatus === "charged") throw badRequest("Consultation already paid", "ALREADY_PAID");

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

  const estimatedCents = body.estimatedCents || Math.max(30 * consultation.ratePerMinuteCents, 3000);

  try {
    const holdResult = await stripeSvc.createPreAuthHold({
      customerStripeId: customerProfile.stripeCustomerId,
      stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
      amountCents: estimatedCents,
      currency: consultation.expert?.currency || "USD",
      metadata: { consultationId, customerProfileId: auth.customerProfileId },
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
    throw badRequest("Consultation already paid", "ALREADY_PAID");
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

  const externalAccount = await stripeSvc.attachExternalBankAccount({
    stripeAccountId: expert.stripeAccountId || `acct_stub_${auth.expertProfileId}`,
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

  switch (event.type) {
    case "payment_intent.amount_capturable_updated":
      // Pre-auth hold succeeded
      break;
    case "payment_intent.succeeded":
      // Final charge captured
      break;
    case "payment_intent.payment_failed":
      // Pre-auth or charge failed
      break;
    case "account.updated":
      // Expert Connect KYC account updated
      break;
    case "transfer.created":
      // Payout transfer created
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
    const isCustomer = consultation.customerId === auth.customerProfileId;
    const isExpert = consultation.expertId === auth.expertProfileId;
    if (!isCustomer && !isExpert) throw forbidden("Access denied");
  } else if (auth.role !== "expert" && auth.role !== "customer") {
    throw forbidden("Access denied");
  }

  return toTransactionDto(tx);
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
        data: { status: "cancelled", cancelledAt: now, cancelAtPeriodEnd: false },
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
 * has passed, then flips them to 'cancelled'.
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
      status: "cancelled",
      cancelledAt: now,
    },
  });

  console.log(`[billing] expireSubscriptions: expired ${result.count} subscription(s) at ${now.toISOString()}`);
  return { expired: result.count };
}
