import { centsToAmount, customerDisplayName, resolveMediaUrl, toIso } from "./common.js";
import { expertDisplayName } from "./expert.mapper.js";

export function toQuoteSummaryDto(quote, { customerUser, customerProfile, expertProfile, attachments, currency = "USD" }) {
  const attachmentCount = Array.isArray(attachments)
    ? attachments.length
    : quote.attachments?.length ?? 0;

  return {
    id: quote.id,
    referenceNumber: quote.referenceNumber ?? null,
    title: quote.title,
    category: quote.category ?? null,
    status: quote.status,
    expertId: quote.expertId,
    expertName: expertDisplayName(expertProfile),
    expertAvatarUrl: resolveMediaUrl(expertProfile?.avatarMedia?.storageKey),
    customerId: quote.customerId,
    customerName: customerDisplayName(customerUser, customerProfile),
    budget: centsToAmount(quote.budgetCents),
    currency,
    attachmentCount,
    createdAt: toIso(quote.createdAt),
    updatedAt: toIso(quote.updatedAt),
  };
}

export function toQuoteDetailDto(
  quote,
  { customerUser, customerProfile, expertProfile, attachments = [], currency = "USD" }
) {
  const expertQuote =
    quote.status === "quoted" || quote.expertQuoteAmountCents != null
      ? {
          amount: centsToAmount(quote.expertQuoteAmountCents),
          currency,
          notes: quote.expertQuoteNotes,
          timeline: quote.expertQuoteTimeline ?? null,
          quotedAt: toIso(quote.quotedAt),
        }
      : null;

  const contactName = customerDisplayName(customerUser, customerProfile);

  return {
    id: quote.id,
    referenceNumber: quote.referenceNumber ?? null,
    title: quote.title,
    description: quote.description,
    notes: quote.notes ?? null,
    category: quote.category ?? null,
    preferredLocation: quote.preferredLocation ?? null,
    status: quote.status,
    budget: centsToAmount(quote.budgetCents),
    currency,
    expertId: quote.expertId,
    expertName: expertDisplayName(expertProfile),
    expertTitle: expertProfile?.title ?? null,
    expertHeadline: expertProfile?.headline ?? null,
    expertAvatarUrl: resolveMediaUrl(expertProfile?.avatarMedia?.storageKey),
    customerId: quote.customerId,
    customerName: contactName,
    contactName,
    contactPhone: customerUser?.phone ?? null,
    customerAvatarUrl: resolveMediaUrl(customerProfile?.avatarMedia?.storageKey),
    attachments: attachments.map((a) => ({
      id: a.id,
      mediaId: a.mediaId,
      url: resolveMediaUrl(a.media?.storageKey),
      mimeType: a.media?.mimeType ?? null,
      uploadedByRole: a.uploadedByRole ?? "customer",
    })),
    expertQuote,
    expiresAt: toIso(quote.expiresAt),
    submittedAt: toIso(quote.submittedAt),
    reviewedAt: toIso(quote.reviewedAt),
    resolvedAt: toIso(quote.resolvedAt),
    createdAt: toIso(quote.createdAt),
    updatedAt: toIso(quote.updatedAt),
  };
}

export function toQuoteStatusEventDto(event) {
  return {
    id: event.id,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    note: event.note,
    createdAt: toIso(event.createdAt),
  };
}

export function toQuoteHistoryDto(quoteId, events) {
  return {
    quoteId,
    events: events.map(toQuoteStatusEventDto),
  };
}
