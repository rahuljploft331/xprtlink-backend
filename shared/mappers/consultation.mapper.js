import { centsToAmount, customerDisplayName, toIso, resolveMediaUrl } from "./common.js";
import { expertDisplayName } from "./expert.mapper.js";

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

  return {
    id: consultation.id,
    title: consultation.title,
    note: consultation.note,
    status: consultation.status,
    expertId: consultation.expertId,
    expertName: expertDisplayName(expertProfile),
    expertAvatar: resolveMediaUrl(expertProfile?.avatarMedia?.storageKey),
    expertRating: hasReview ? Number(review.rating) : null,
    customerId: consultation.customerId,
    customerName: customerDisplayName(customerUser, customerProfile),
    customerAvatar: resolveMediaUrl(customerProfile?.avatarMedia?.storageKey),
    ratePerMinute: centsToAmount(consultation.ratePerMinuteCents),
    currency,
    durationSeconds: consultation.durationSeconds,
    billingStatus: consultation.billingStatus,
    requestedAt: toIso(consultation.requestedAt),
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

export function toConsultationBillingSummaryDto(consultation, { commissionCents = 0 }) {
  const durationSeconds = consultation.durationSeconds ?? 0;
  const ratePerMinute = centsToAmount(consultation.ratePerMinuteCents);
  const minutes = durationSeconds / 60;
  const subtotalCents = Math.ceil(minutes * consultation.ratePerMinuteCents);
  const commission = centsToAmount(commissionCents || Math.round(subtotalCents * 0.15));
  const subtotal = centsToAmount(subtotalCents);

  return {
    consultationId: consultation.id,
    durationSeconds,
    ratePerMinute,
    currency: consultation.currency ?? "USD",
    subtotal,
    commission,
    total: subtotal,
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
