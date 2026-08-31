import { centsToAmount, customerDisplayName, resolveMediaUrl, toIso } from "./common.js";
import { expertDisplayName } from "./expert.mapper.js";

export function toQuoteSummaryDto(quote, { customerUser, expertProfile, currency = "USD" }) {
  return {
    id: quote.id,
    referenceNumber: quote.referenceNumber ?? null,
    title: quote.title,
    category: quote.category ?? null,
    status: quote.status,
    expertId: quote.expertId,
    expertName: expertDisplayName(expertProfile),
    customerId: quote.customerId,
    customerName: customerDisplayName(customerUser),
    budget: centsToAmount(quote.budgetCents),
    currency,
    createdAt: toIso(quote.createdAt),
    updatedAt: toIso(quote.updatedAt),
  };
}

export function toQuoteDetailDto(quote, { customerUser, expertProfile, attachments = [], currency = "USD" }) {
  const expertQuote =
    quote.status === "quoted" || quote.expertQuoteAmountCents != null
      ? {
          amount: centsToAmount(quote.expertQuoteAmountCents),
          currency,
          notes: quote.expertQuoteNotes,
          quotedAt: toIso(quote.quotedAt),
        }
      : null;

  return {
    id: quote.id,
    referenceNumber: quote.referenceNumber ?? null,
    title: quote.title,
    description: quote.description,
    category: quote.category ?? null,
    preferredLocation: quote.preferredLocation ?? null,
    status: quote.status,
    budget: centsToAmount(quote.budgetCents),
    currency,
    expertId: quote.expertId,
    expertName: expertDisplayName(expertProfile),
    customerId: quote.customerId,
    customerName: customerDisplayName(customerUser),
    attachments: attachments.map((a) => ({
      id: a.id,
      mediaId: a.mediaId,
      url: resolveMediaUrl(a.media?.storageKey),
      mimeType: a.media?.mimeType ?? null,
    })),
    expertQuote,
    expiresAt: toIso(quote.expiresAt),
    submittedAt: toIso(quote.submittedAt),
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
