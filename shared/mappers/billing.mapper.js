import { centsToAmount, toIso } from "./common.js";

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
  return {
    id: tx.id,
    type: tx.type,
    amount: centsToAmount(tx.amountCents),
    currency: tx.currency,
    status: tx.status,
    createdAt: toIso(tx.createdAt),
  };
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
  return {
    id: entry.id,
    consultationId: entry.consultationId,
    grossAmount: centsToAmount(entry.grossCents),
    commissionAmount: centsToAmount(entry.commissionCents),
    netAmount: centsToAmount(entry.netCents),
    currency,
    createdAt: toIso(entry.createdAt),
  };
}
