import crypto from "crypto";
import { getDb } from "@xprtlink/shared/db";
import {
  toEarningsEntryDto,
  toExpertSubscriptionDto,
  toPaymentMethodDto,
  toSubscriptionPlanDto,
  toTransactionDto,
} from "@xprtlink/shared/mappers/billing.mapper.js";
import { badRequest, forbidden, notFound } from "@xprtlink/shared/utils/errors.js";
import { parsePagination, paginatedResult } from "@xprtlink/shared/utils/pagination.js";

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
  const stripePaymentMethodId =
    body.stripePaymentMethodId || `pm_stub_${crypto.randomUUID()}`;

  if (body.setDefault) {
    await db.paymentMethod.updateMany({
      where: { customerProfileId: auth.customerProfileId },
      data: { isDefault: false },
    });
  }

  const isFirst =
    (await db.paymentMethod.count({
      where: { customerProfileId: auth.customerProfileId },
    })) === 0;

  const method = await db.paymentMethod.create({
    data: {
      customerProfileId: auth.customerProfileId,
      stripePaymentMethodId,
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
  if (consultation.billingStatus === "charged") {
    throw badRequest("Consultation already paid", "ALREADY_PAID");
  }
  if (consultation.charge) {
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

  const commissionCents = Math.round(amountCents * COMMISSION_RATE);
  const expertShareCents = amountCents - commissionCents;
  const currency = consultation.expert.currency || "USD";

  // Stripe PaymentIntent stub — always succeeds locally.
  const stripePaymentIntentId = `pi_stub_${crypto.randomUUID()}`;

  const result = await db.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: {
        type: "consultation_charge",
        amountCents,
        currency,
        status: "succeeded",
        stripePaymentIntentId,
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
  const plan = await db.subscriptionPlan.findFirst({
    where: { id: body.planId, isActive: true },
  });
  if (!plan) throw notFound("Subscription plan not found");

  // IAP receipt validation stub — accept any non-empty receiptData.
  const externalSubscriptionId = `iap_stub_${crypto.randomUUID()}`;
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const subscription = await db.$transaction(async (tx) => {
    await tx.expertSubscription.updateMany({
      where: { expertProfileId: auth.expertProfileId, status: "active" },
      data: { status: "cancelled", cancelledAt: now },
    });

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
  const subscription = await getDb().expertSubscription.findFirst({
    where: { expertProfileId: auth.expertProfileId, status: "active" },
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
