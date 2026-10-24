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
  const brand = tx.metadata?.brand;
  const last4 = tx.metadata?.last4;
  const method = tx.metadata?.paymentMethod || (brand && last4 ? `${brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase()} •••• ${last4}` : (tx.method ?? null));

  const dto = {
    id: tx.id,
    type: tx.type,
    amount: centsToAmount(tx.amountCents),
    currency: tx.currency,
    status: tx.status,
    method,
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
    // Website (Stripe) pricing — additive; app clients keep using priceMonthly.
    webPriceMonthly: centsToAmount(plan.webPriceMonthlyCents ?? plan.priceMonthlyCents),
    webTrialDays: plan.webTrialDays ?? 0,
    currency,
    visibilityBoost: plan.visibilityBoost,
    isMostPopular: plan.isMostPopular ?? false,
    keyFeatures: plan.keyFeatures ?? [],
    // Store-side product identifiers — needed by Flutter to initiate IAP purchases.
    appleProductId: plan.appleProductId ?? null,
    googleProductId: plan.googleProductId ?? null,
  };
}

const PLATFORM_BY_STORE = { apple: "ios", google: "android", stripe: "web" };

export function toExpertSubscriptionDto(subscription, plan, currency = "USD") {
  return {
    id: subscription.id,
    plan: toSubscriptionPlanDto(plan, currency),
    store: subscription.store,
    gateway: subscription.store,
    subscribedVia: subscription.store,
    status: subscription.status,
    platform: PLATFORM_BY_STORE[subscription.store] ?? subscription.store,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
    // Derived: auto-renew is on until a verified store event / Stripe flag turns it off.
    autoRenewEnabled: !(subscription.cancelAtPeriodEnd ?? false),
    lastVerifiedAt: toIso(subscription.lastVerifiedAt ?? null),
    currentPeriodStart: toIso(subscription.currentPeriodStart),
    currentPeriodEnd: toIso(subscription.currentPeriodEnd),
    gracePeriodEnd: toIso(subscription.gracePeriodEnd ?? null),
    canceledAt: toIso(subscription.canceledAt),
    trialEndsAt: toIso(subscription.trialEndsAt ?? null),
  };
}

export function toEarningsEntryDto(entry, currency = "USD") {
  const consultation = entry.consultation;
  const customerName = consultation?.customer
    ? fullName(consultation.customer.firstName, consultation.customer.lastName)
    : "Customer";
  const customerInitials = consultation?.customer?.firstName?.charAt(0)?.toUpperCase() ?? "?";
  const customerAvatarUrl = resolveMediaUrl(consultation?.customer?.avatarMedia?.storageKey) ?? null;

  return {
    id: entry.id,
    consultationId: entry.consultationId,
    customerName,
    customerInitials,
    customerAvatarUrl,
    durationMinutes: consultation?.durationSeconds ? Math.round(consultation.durationSeconds / 60) : 0,
    status: consultation?.billingStatus === "charged" ? "PAID" : "PENDING",
    // `status` is about the customer's charge. Payout status is whether the
    // expert's share has actually been sent to their bank:
    //   UNPAID (not in a payout yet) | PROCESSING | PAID_OUT | FAILED
    payoutStatus: earningsPayoutStatus(entry),
    payoutId: entry.payoutId ?? null,
    grossAmount: centsToAmount(entry.grossCents),
    commissionAmount: centsToAmount(entry.commissionCents),
    netAmount: centsToAmount(entry.netCents),
    currency,
    createdAt: toIso(entry.createdAt),
  };
}

function earningsPayoutStatus(entry) {
  if (!entry.payoutId) return "UNPAID";
  switch (entry.payout?.status) {
    case "paid":
      return "PAID_OUT";
    case "failed":
      return "FAILED";
    default:
      return "PROCESSING";
  }
}

/** Expert payout — an aggregated Stripe Connect transfer of settled earnings. */
export function toExpertPayoutDto(payout) {
  return {
    id: payout.id,
    expertProfileId: payout.expertProfileId,
    amountCents: payout.amountCents,
    amount: centsToAmount(payout.amountCents),
    currency: payout.currency,
    status: payout.status,
    periodStart: toIso(payout.periodStart),
    periodEnd: toIso(payout.periodEnd),
    stripeTransferId: payout.stripeTransferId ?? null,
    createdAt: toIso(payout.createdAt),
    updatedAt: toIso(payout.updatedAt),
  };
}
