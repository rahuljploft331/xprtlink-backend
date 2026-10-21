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
    locationDetails: quote.locationDetails ?? null,
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

// ─── Lifecycle (display-ready timeline) ──────────────────────────────────────

const LIFECYCLE_PATH = ["submitted", "expert_reviewed", "quoted", "decision"];

// Rank of the furthest happy-path step each status has reached.
const LIFECYCLE_REACHED = {
  draft: -1,
  submitted: 0,
  pending_expert_review: 0,
  expert_reviewed: 1,
  quoted: 2,
  accepted: 3,
};

const TERMINAL_STATUSES = new Set(["rejected", "canceled", "expired"]);

function lifecycleCopy(role) {
  const expert = role === "expert";
  return {
    submitted: {
      icon: "check",
      done: expert ? "Request Received" : "Request Submitted",
      pending: expert ? "Request Received" : "Request Submitted",
    },
    expert_reviewed: {
      icon: "eye",
      done: expert ? "You Reviewed" : "Expert Reviewed",
      pending: expert ? "Waiting for your review" : "Waiting for expert to review",
    },
    quoted: {
      icon: "receipt",
      done: expert ? "Quote Sent" : "Quote Received",
      pending: expert ? "Draft and send your quote" : "Expert is drafting quote",
    },
    decision: {
      icon: "handshake",
      done: "Quote Accepted",
      pending: expert ? "Waiting for customer decision" : "Your decision",
    },
    rejected: { icon: "cancel", done: "Quote Rejected" },
    canceled: { icon: "cancel", done: "Request Canceled" },
    expired: { icon: "timer_off", done: "Request Expired" },
  };
}

// Who closed the journey changes the wording: "You declined" vs "Expert declined".
function terminalTitle(status, role, actorIsCustomer, fallback) {
  const viewerIsCustomer = role !== "expert";
  if (status === "canceled") {
    return viewerIsCustomer ? "You Canceled the Request" : "Customer Canceled the Request";
  }
  if (status === "rejected" && actorIsCustomer != null) {
    if (actorIsCustomer) return viewerIsCustomer ? "You Rejected the Quote" : "Customer Rejected Your Quote";
    return viewerIsCustomer ? "Expert Declined Your Request" : "You Declined the Request";
  }
  return fallback;
}

/**
 * Display-ready lifecycle for the Activity Timeline screen. Returns the steps
 * already reached plus the single next pending step; terminal outcomes
 * (rejected / canceled / expired) close the timeline instead.
 *
 * State per step: `completed` | `current` (latest reached, highlighted) | `pending`.
 */
export function toQuoteLifecycleDto(
  quote,
  events,
  { role, customerUser, customerProfile, expertProfile }
) {
  const copy = lifecycleCopy(role);
  const firstAt = (status) => {
    const e = events.find((ev) => ev.toStatus === status);
    return e ? toIso(e.createdAt) : null;
  };
  const noteFor = (status) => events.find((ev) => ev.toStatus === status)?.note ?? null;

  const terminal = TERMINAL_STATUSES.has(quote.status);

  // A terminal status closes the journey at the furthest step actually reached.
  let reachedRank;
  if (terminal) {
    const reachedKeys = events.map((ev) => LIFECYCLE_REACHED[ev.toStatus] ?? -1);
    reachedRank = Math.max(0, ...reachedKeys, quote.quotedAt ? 2 : -1, quote.reviewedAt ? 1 : -1);
  } else {
    reachedRank = LIFECYCLE_REACHED[quote.status] ?? 0;
  }

  const occurredAt = {
    submitted: firstAt("submitted") ?? toIso(quote.submittedAt ?? quote.createdAt),
    expert_reviewed: firstAt("expert_reviewed") ?? toIso(quote.reviewedAt),
    quoted: firstAt("quoted") ?? toIso(quote.quotedAt),
    decision: firstAt("accepted") ?? (quote.status === "accepted" ? toIso(quote.resolvedAt) : null),
  };

  const steps = [];
  LIFECYCLE_PATH.forEach((key, rank) => {
    if (rank <= reachedRank) {
      steps.push({
        key,
        title: copy[key].done,
        icon: copy[key].icon,
        state: !terminal && rank === reachedRank ? "current" : "completed",
        occurredAt: occurredAt[key],
        note: key === "quoted" ? null : noteFor(key === "decision" ? "accepted" : key),
      });
    }
  });

  if (terminal) {
    const t = quote.status;
    const resolved = events.filter((ev) => ev.toStatus === t).at(-1);
    steps.push({
      key: t,
      title: terminalTitle(
        t,
        role,
        resolved?.actorUserId ? resolved.actorUserId === customerUser?.id : null,
        copy[t].done
      ),
      icon: copy[t].icon,
      state: "current",
      occurredAt: resolved ? toIso(resolved.createdAt) : toIso(quote.resolvedAt ?? quote.updatedAt),
      note: resolved?.note ?? null,
    });
  } else if (reachedRank < LIFECYCLE_PATH.length - 1) {
    const nextKey = LIFECYCLE_PATH[reachedRank + 1];
    steps.push({
      key: nextKey,
      title: copy[nextKey].pending,
      icon: "hourglass",
      state: "pending",
      occurredAt: null,
      note: null,
    });
  }

  const current = [...steps].reverse().find((s) => s.state === "current") ?? steps.at(-1);
  const isActive = !terminal && quote.status !== "accepted";
  const counterpartIsExpert = role !== "expert";

  return {
    quoteId: quote.id,
    referenceNumber: quote.referenceNumber ?? null,
    title: quote.title,
    status: quote.status,
    currentStep: current.key,
    currentStepTitle: current.title,
    isActive,
    outcome: isActive ? null : quote.status,
    counterparty: counterpartIsExpert
      ? {
          role: "expert",
          name: expertDisplayName(expertProfile),
          avatarUrl: resolveMediaUrl(expertProfile?.avatarMedia?.storageKey),
        }
      : {
          role: "customer",
          name: customerDisplayName(customerUser, customerProfile),
          avatarUrl: resolveMediaUrl(customerProfile?.avatarMedia?.storageKey),
        },
    steps,
  };
}
