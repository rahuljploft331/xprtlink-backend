import { centsToAmount, toIso, fullName, resolveMediaUrl } from "./common.js";

export function toPaymentMethodDto(method) {
  return {
    id: method.id,
    brand: method.brand,
    last4: method.last4,
    expMonth: method.expMonth,
    expYear: method.expYear,
    isDefault: method.isDefault,
  };
}

export function toTransactionDto(tx) {
  const dto = {
    id: tx.id,
    type: tx.type,
    amount: centsToAmount(tx.amountCents),
    currency: tx.currency,
    status: tx.status,
    createdAt: toIso(tx.createdAt),
  };

  if (tx.consultationCharge?.consultation) {
    const consultation = tx.consultationCharge.consultation;
    if (consultation.expert) {
      dto.expertName = fullName(consultation.expert.firstName, consultation.expert.lastName);
      const media = consultation.expert.avatarMedia;
      dto.expertImage = media?.storageKey ? resolveMediaUrl(media.storageKey) : null;
    }
    
    dto.subject = consultation.category || consultation.title || "Consultation";
    dto.isOnline = true; // Placeholder for online status, though not stored per transaction
    dto.consultationId = consultation.id;
  }

  return dto;
}

export function toSubscriptionPlanDto(plan, currency = "USD") {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    tagline: plan.tagline ?? null,
    priceMonthly: centsToAmount(plan.priceMonthlyCents),
    currency,
    visibilityBoost: plan.visibilityBoost,
    isMostPopular: plan.isMostPopular ?? false,
    keyFeatures: plan.keyFeatures ?? [],
  };
}

export function toExpertSubscriptionDto(subscription, plan, currency = "USD") {
  return {
    id: subscription.id,
    plan: toSubscriptionPlanDto(plan, currency),
    store: subscription.store,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
    currentPeriodStart: toIso(subscription.currentPeriodStart),
    currentPeriodEnd: toIso(subscription.currentPeriodEnd),
    canceledAt: toIso(subscription.canceledAt),
  };
}

export function toEarningsEntryDto(entry, currency = "USD") {
  const consultation = entry.consultation;
  const customerName = consultation?.customer
    ? fullName(consultation.customer.firstName, consultation.customer.lastName)
    : "Customer";
  const customerInitials = consultation?.customer?.firstName?.charAt(0)?.toUpperCase() ?? "?";

  return {
    id: entry.id,
    consultationId: entry.consultationId,
    customerName,
    customerInitials,
    durationMinutes: consultation?.durationSeconds ? Math.round(consultation.durationSeconds / 60) : 0,
    status: consultation?.billingStatus === "charged" ? "PAID" : "PENDING",
    grossAmount: centsToAmount(entry.grossCents),
    commissionAmount: centsToAmount(entry.commissionCents),
    netAmount: centsToAmount(entry.netCents),
    currency,
    createdAt: toIso(entry.createdAt),
  };
}
