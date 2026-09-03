import {
  computeConsultationChargeCents,
  computeConsultationCommissionCents,
  consultationBillableMinutes,
  perMinuteCentsFromListedRate,
} from "../lib/consultationBilling.js";
import { centsToAmount, customerDisplayName, toIso, resolveMediaUrl } from "./common.js";
import { expertDisplayName } from "./expert.mapper.js";

/** Short session code for history/detail UI, e.g. CON-37535A. Prefix with # in the app. */
export function consultationDisplayId(id) {
  const hex = String(id ?? "").replace(/-/g, "");
  return `CON-${hex.slice(-6).toUpperCase()}`;
}

/**
 * Review this consultation's customer submitted for this session.
 * History/detail APIs are session-relative — do not use ExpertProfile.ratingAvg here.
 */
export function customerConsultationReview(consultation) {
  const review = consultation?.review ?? null;
  if (!review) return null;
  if (review.customerId && consultation.customerId && review.customerId !== consultation.customerId) {
    return null;
  }
  return review;
}

export function toConsultationSummaryDto(
  consultation,
  { customerUser, customerProfile, expertProfile, currency = "USD" }
) {
  const review = customerConsultationReview(consultation);
  const hasReview = review != null;
  const ratingCount = expertProfile?.ratingCount ?? 0;

  return {
    id: consultation.id,
    displayId: consultationDisplayId(consultation.id),
    title: consultation.title,
    note: consultation.note,
    status: consultation.status,
    expertId: consultation.expertId,
    expertName: expertDisplayName(expertProfile),
    expertAvatar: resolveMediaUrl(expertProfile?.avatarMedia?.storageKey),
    expertTitle: expertProfile?.title ?? expertProfile?.headline ?? null,
    expertVerificationStatus: expertProfile?.verificationStatus ?? null,
    expertRating: hasReview ? Number(review.rating) : null,
    expertRatingAvg: ratingCount > 0 ? Number(expertProfile.ratingAvg) : null,
    expertReviewCount: ratingCount,
    customerId: consultation.customerId,
    customerName: customerDisplayName(customerUser, customerProfile),
    customerAvatar: resolveMediaUrl(customerProfile?.avatarMedia?.storageKey),
    ratePer30Minutes: centsToAmount(consultation.ratePerMinuteCents),
    ratePerMinute: centsToAmount(perMinuteCentsFromListedRate(consultation.ratePerMinuteCents)),
    currency,
    durationSeconds: consultation.durationSeconds,
    billableMinutes: consultationBillableMinutes(consultation.durationSeconds),
    total: centsToAmount(computeConsultationChargeCents(consultation)),
    billingStatus: consultation.billingStatus,
    requestedAt: toIso(consultation.requestedAt),
    startedAt: toIso(consultation.startedAt),
    endedAt: toIso(consultation.endedAt),
    hasReview,
  };
}

export function toConsultationDetailDto(consultation, ctx) {
  const summary = toConsultationSummaryDto(consultation, ctx);
  const review = customerConsultationReview(consultation);
  return {
    ...summary,
    acceptedAt: toIso(consultation.acceptedAt),
    startedAt: toIso(consultation.startedAt),
    zegoRoomId: consultation.zegoRoomId,
    hasReview: summary.hasReview,
    review: review ? toReviewDto(review) : null,
  };
}

export function toConsultationBillingSummaryDto(
  consultation,
  { commissionCents = 0, expertShareCents, paymentBrand = null, paymentLast4 = null } = {}
) {
  const durationSeconds = consultation.durationSeconds ?? 0;
  const billableMinutes = consultationBillableMinutes(durationSeconds);
  const ratePer30Minutes = centsToAmount(consultation.ratePerMinuteCents);
  const ratePerMinute = centsToAmount(
    perMinuteCentsFromListedRate(consultation.ratePerMinuteCents)
  );
  const computedCents = computeConsultationChargeCents(consultation);
  const hasCapturedBreakdown =
    Number.isFinite(commissionCents) &&
    Number.isFinite(expertShareCents) &&
    commissionCents + expertShareCents > 0;
  const subtotalCents = hasCapturedBreakdown
    ? commissionCents + expertShareCents
    : computedCents;
  const resolvedCommissionCents =
    commissionCents || computeConsultationCommissionCents(subtotalCents);
  const commission = centsToAmount(resolvedCommissionCents);
  const subtotal = centsToAmount(subtotalCents);
  const expertShare = centsToAmount(
    Number.isFinite(expertShareCents)
      ? expertShareCents
      : subtotalCents - resolvedCommissionCents
  );

  return {
    consultationId: consultation.id,
    durationSeconds,
    billableMinutes,
    ratePer30Minutes,
    ratePerMinute,
    currency: consultation.currency ?? consultation.expert?.currency ?? "USD",
    subtotal,
    commission,
    expertShare,
    total: subtotal,
    billingStatus: consultation.billingStatus ?? null,
    paymentBrand,
    paymentLast4,
  };
}

export function toReviewDto(review) {
  return {
    id: review.id,
    consultationId: review.consultationId,
    rating: review.rating,
    comment: review.comment,
    status: review.status,
    createdAt: toIso(review.createdAt),
  };
}

export function toExpertReportDto(report) {
  return {
    id: report.id,
    expertId: report.expertId,
    reason: report.reason,
    details: report.details,
    status: report.status,
    createdAt: toIso(report.createdAt),
  };
}

export function toVideoTokenDto({ token, appID, roomId, expiresAt }) {
  return {
    token,
    appID: appID ?? null,
    roomId,
    expiresAt: toIso(expiresAt),
  };
}
