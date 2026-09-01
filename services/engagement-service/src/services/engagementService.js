import crypto from "crypto";
import { generateZegoToken } from "@xprtlink/shared/lib/zegoToken.js";
import { getDb } from "@xprtlink/shared/db";
import { internalGet, internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { amountToCents } from "@xprtlink/shared/mappers/common.js";
import {
  toQuoteSummaryDto,
  toQuoteDetailDto,
  toQuoteHistoryDto,
} from "@xprtlink/shared/mappers/quote.mapper.js";
import {
  toConsultationSummaryDto,
  toConsultationDetailDto,
  toConsultationBillingSummaryDto,
  toReviewDto,
  toExpertReportDto,
  toVideoTokenDto,
} from "@xprtlink/shared/mappers/consultation.mapper.js";
import { badRequest, conflict, forbidden, notFound } from "@xprtlink/shared/utils/errors.js";
import { parsePagination, paginatedResult } from "@xprtlink/shared/utils/pagination.js";

const QUOTE_INCLUDE = {
  customer: { include: { user: true, avatarMedia: true } },
  expert: { include: { avatarMedia: true } },
  attachments: { include: { media: true } },
};

const CONSULTATION_INCLUDE = {
  customer: { include: { user: true } },
  expert: true,
  review: true,
};

const EDITABLE_QUOTE_STATUSES = new Set(["draft", "submitted", "pending_expert_review", "expert_reviewed"]);
const CANCELLABLE_QUOTE_STATUSES = new Set(["draft", "submitted", "pending_expert_review", "expert_reviewed"]);
// Statuses from which an expert may submit a quotation.
const QUOTABLE_QUOTE_STATUSES = new Set(["pending_expert_review", "expert_reviewed"]);
// Statuses that make up the expert "inbox" (awaiting action from the expert).
const INBOX_QUOTE_STATUSES = ["pending_expert_review", "expert_reviewed"];
const ACTIVE_CONSULTATION_STATUSES = new Set(["requested", "ringing", "accepted", "in_progress"]);

// Crockford base32 alphabet — excludes ambiguous chars (0/O, 1/I/L, U).
const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Generates a human-friendly quote reference, e.g. "QR-8F3KD2". */
function generateQuoteReference(length = 6) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)];
  }
  return `QR-${code}`;
}

/**
 * Returns a reference number guaranteed unique against existing quotes.
 * Retries on the rare collision (unique index also guards at the DB level).
 */
async function uniqueQuoteReference(tx, attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    const candidate = generateQuoteReference();
    const existing = await tx.quoteRequest.findUnique({
      where: { referenceNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // Fall back to a longer code to virtually eliminate collision risk.
  return generateQuoteReference(10);
}

function assertCustomer(auth) {
  if (auth.role !== "customer" || !auth.customerProfileId) {
    throw forbidden("Customer access required");
  }
}

function assertExpert(auth) {
  if (auth.role !== "expert" || !auth.expertProfileId) {
    throw forbidden("Expert access required");
  }
}

function assertQuoteParticipant(auth, quote) {
  const isCustomer = auth.customerProfileId === quote.customerId;
  const isExpert = auth.expertProfileId === quote.expertId;
  if (!isCustomer && !isExpert) throw forbidden("Not authorized for this quote");
}

function assertQuoteCustomer(auth, quote) {
  if (auth.customerProfileId !== quote.customerId) {
    throw forbidden("Only the requesting customer can perform this action");
  }
}

function assertQuoteExpert(auth, quote) {
  if (auth.expertProfileId !== quote.expertId) {
    throw forbidden("Only the assigned expert can perform this action");
  }
}

function assertConsultationParticipant(auth, consultation) {
  const isCustomer = auth.customerProfileId === consultation.customerId;
  const isExpert = auth.expertProfileId === consultation.expertId;
  if (!isCustomer && !isExpert) throw forbidden("Not authorized for this consultation");
}

function quoteContext(quote) {
  return {
    customerUser: quote.customer.user,
    customerProfile: quote.customer,
    expertProfile: quote.expert,
    attachments: quote.attachments ?? [],
    currency: quote.expert.currency,
  };
}

function consultationContext(consultation) {
  return {
    customerUser: consultation.customer.user,
    customerProfile: consultation.customer,
    expertProfile: consultation.expert,
    currency: consultation.expert.currency,
    hasReview: Boolean(consultation.review),
  };
}

async function loadQuote(id) {
  const quote = await getDb().quoteRequest.findUnique({
    where: { id },
    include: QUOTE_INCLUDE,
  });
  if (!quote) throw notFound("Quote not found");
  return quote;
}

async function loadConsultation(id) {
  const consultation = await getDb().consultation.findUnique({
    where: { id },
    include: CONSULTATION_INCLUDE,
  });
  if (!consultation) throw notFound("Consultation not found");
  return consultation;
}

async function recordQuoteTransition(tx, { quoteId, fromStatus, toStatus, actorUserId, note, data = {} }) {
  await tx.quoteStatusEvent.create({
    data: {
      quoteId,
      fromStatus,
      toStatus,
      actorUserId,
      note: note ?? null,
    },
  });
  return tx.quoteRequest.update({
    where: { id: quoteId },
    data: { status: toStatus, ...data },
    include: QUOTE_INCLUDE,
  });
}

// ─── Quotes ──────────────────────────────────────────────────────────────────

export async function createQuote(auth, body) {
  assertCustomer(auth);
  const db = getDb();
  let expert = null;

  if (body.expertId) {
    // If client specified an expert, it MUST exist — no silent fallback
    expert = await db.expertProfile.findFirst({ where: { id: body.expertId } });
    if (!expert) throw notFound("Expert not found");
  } else {
    // No specific expert requested — find any approved expert (discovery-style quote)
    expert = await db.expertProfile.findFirst({ where: { verificationStatus: "approved" } });
    if (!expert) throw notFound("No approved experts available to receive quotes");
  }

  const now = new Date();
  const quote = await db.$transaction(async (tx) => {
    const referenceNumber = await uniqueQuoteReference(tx);
    const created = await tx.quoteRequest.create({
      data: {
        referenceNumber,
        customerId: auth.customerProfileId,
        expertId: expert.id,
        title: body.title,
        description: body.description,
        category: body.category ?? null,
        preferredLocation: body.preferredLocation ?? null,
        budgetCents: amountToCents(body.budget),
        notes: body.notes ?? null,
        status: "submitted",
        submittedAt: now,
      },
      include: QUOTE_INCLUDE,
    });

    if (body.mediaIds?.length) {
      await tx.quoteAttachment.createMany({
        data: body.mediaIds.map((mediaId) => ({
          quoteId: created.id,
          mediaId,
          uploadedByRole: "customer",
        })),
        skipDuplicates: true,
      });
    }

    await tx.quoteStatusEvent.create({
      data: {
        quoteId: created.id,
        fromStatus: null,
        toStatus: "submitted",
        actorUserId: auth.userId,
        note: "Quote request submitted",
      },
    });

    return recordQuoteTransition(tx, {
      quoteId: created.id,
      fromStatus: "submitted",
      toStatus: "pending_expert_review",
      actorUserId: auth.userId,
      note: "Awaiting expert review",
    });
  });

  // Notify assigned expert about the new quote request (non-fatal)
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const customerName = `${quote.customer.firstName ?? ""} ${quote.customer.lastName ?? ""}`.trim() || "A customer";
    await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
      userIds: [quote.expert.userId],
      type: "quote_received",
      title: "New Quote Request",
      body: `${customerName} sent you a new quote request: "${quote.title}"`,
      data: { quoteId: quote.id, referenceNumber: quote.referenceNumber },
    });
  } catch (err) {
    console.error(`[createQuote] Notification dispatch failed: ${err.message}`);
  }

  return toQuoteDetailDto(quote, quoteContext(quote));
}

export async function updateQuote(auth, quoteId, body) {
  const quote = await loadQuote(quoteId);
  assertQuoteCustomer(auth, quote);

  const db = getDb();
  const updated = await db.$transaction(async (tx) => {
    // Re-check status inside transaction to prevent TOCTOU race
    const current = await tx.quoteRequest.findUnique({ where: { id: quoteId } });
    if (!current || !EDITABLE_QUOTE_STATUSES.has(current.status)) {
      throw badRequest("Quote cannot be edited in its current status", "INVALID_STATUS");
    }

    const data = {
      ...(body.title ? { title: body.title } : {}),
      ...(body.description ? { description: body.description } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.preferredLocation !== undefined
        ? { preferredLocation: body.preferredLocation }
        : {}),
      ...(body.budget !== undefined ? { budgetCents: amountToCents(body.budget) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    };

    if (body.mediaIds?.length) {
      await tx.quoteAttachment.createMany({
        data: body.mediaIds.map((mediaId) => ({
          quoteId,
          mediaId,
          uploadedByRole: "customer",
        })),
        skipDuplicates: true,
      });
    }

    return tx.quoteRequest.update({
      where: { id: quoteId },
      data,
      include: QUOTE_INCLUDE,
    });
  });

  return toQuoteDetailDto(updated, quoteContext(updated));
}

export async function listQuotes(auth, query) {
  const { page, limit, skip } = parsePagination(query);
  const role = query.role === "expert" || query.role === "customer" ? query.role : auth.role;

  const where = {};
  if (role === "customer") {
    if (!auth.customerProfileId) throw forbidden("Customer access required");
    where.customerId = auth.customerProfileId;
  } else if (role === "expert") {
    if (!auth.expertProfileId) throw forbidden("Expert access required");
    where.expertId = auth.expertProfileId;
    if (query.inbox === "true" || query.inbox === true) {
      where.status = { in: INBOX_QUOTE_STATUSES };
    }
  } else {
    throw badRequest("Invalid role filter");
  }

  if (query.status) where.status = query.status;

  const db = getDb();
  const [rows, total] = await Promise.all([
    db.quoteRequest.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
      include: QUOTE_INCLUDE,
    }),
    db.quoteRequest.count({ where }),
  ]);

  const items = rows.map((q) => toQuoteSummaryDto(q, quoteContext(q)));
  return paginatedResult(items, { page, limit, total });
}

export async function getQuote(auth, quoteId) {
  const quote = await loadQuote(quoteId);
  assertQuoteParticipant(auth, quote);

  // First time the assigned expert opens a pending request, record that they
  // reviewed it — this drives the "Expert Reviewed" step in the audit trail.
  if (
    auth.role === "expert" &&
    auth.expertProfileId === quote.expertId &&
    quote.status === "pending_expert_review"
  ) {
    const reviewed = await getDb().$transaction(async (tx) => {
      const current = await tx.quoteRequest.findUnique({ where: { id: quoteId } });
      // Re-check inside the transaction to avoid racing a concurrent open.
      if (!current || current.status !== "pending_expert_review") return null;
      return recordQuoteTransition(tx, {
        quoteId,
        fromStatus: current.status,
        toStatus: "expert_reviewed",
        actorUserId: auth.userId,
        note: "Expert reviewed the request",
        data: { reviewedAt: new Date() },
      });
    });
    if (reviewed) return toQuoteDetailDto(reviewed, quoteContext(reviewed));
  }

  return toQuoteDetailDto(quote, quoteContext(quote));
}

export async function submitQuotation(auth, quoteId, body) {
  assertExpert(auth);
  // Pre-flight check (authorization only — status re-checked inside transaction)
  const quote = await loadQuote(quoteId);
  assertQuoteExpert(auth, quote);

  const now = new Date();
  const updated = await getDb().$transaction(async (tx) => {
    // Re-read inside transaction with optimistic status guard
    const current = await tx.quoteRequest.findUnique({ where: { id: quoteId } });
    if (!current || !QUOTABLE_QUOTE_STATUSES.has(current.status)) {
      throw badRequest("Quote is not awaiting a quotation", "INVALID_STATUS");
    }

    // Persist any media the expert attached to their quotation, tagged with
    // the expert role so the client can separate them from the customer's files.
    if (body.mediaIds?.length) {
      await tx.quoteAttachment.createMany({
        data: body.mediaIds.map((mediaId) => ({
          quoteId,
          mediaId,
          uploadedByRole: "expert",
        })),
        skipDuplicates: true,
      });
    }

    return recordQuoteTransition(tx, {
      quoteId,
      fromStatus: current.status,
      toStatus: "quoted",
      actorUserId: auth.userId,
      note: body.notes ?? "Expert quotation submitted",
      data: {
        expertQuoteAmountCents: amountToCents(body.amount),
        expertQuoteNotes: body.notes ?? null,
        expertQuoteTimeline: body.timeline ?? null,
        quotedAt: now,
      },
    });
  });

  // Notify customer that the expert has submitted a quotation (non-fatal)
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const expertName = `${updated.expert.firstName ?? ""} ${updated.expert.lastName ?? ""}`.trim() || "Your expert";
    await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
      userIds: [updated.customer.user.id],
      type: "quote_submitted",
      title: "Quote Ready",
      body: `${expertName} has sent you a quote for "${updated.title}"`,
      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });
  } catch (err) {
    console.error(`[submitQuotation] Notification dispatch failed: ${err.message}`);
  }

  return toQuoteDetailDto(updated, quoteContext(updated));
}

export async function acceptQuote(auth, quoteId) {
  assertCustomer(auth);
  // Pre-flight check (authorization only — status re-checked inside transaction)
  const quote = await loadQuote(quoteId);
  assertQuoteCustomer(auth, quote);

  const updated = await getDb().$transaction(async (tx) => {
    const current = await tx.quoteRequest.findUnique({ where: { id: quoteId } });
    if (!current || current.status !== "quoted") {
      throw badRequest("Only quoted requests can be accepted", "INVALID_STATUS");
    }
    return recordQuoteTransition(tx, {
      quoteId,
      fromStatus: current.status,
      toStatus: "accepted",
      actorUserId: auth.userId,
      note: "Customer accepted quotation",
      data: { resolvedAt: new Date() },
    });
  });

  // Notify expert that the customer accepted their quotation (non-fatal)
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const customerName = `${updated.customer.firstName ?? ""} ${updated.customer.lastName ?? ""}`.trim() || "A customer";
    await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
      userIds: [updated.expert.userId],
      type: "quote_accepted",
      title: "Quote Accepted",
      body: `${customerName} accepted your quote for "${updated.title}"`,
      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });
  } catch (err) {
    console.error(`[acceptQuote] Notification dispatch failed: ${err.message}`);
  }

  return toQuoteDetailDto(updated, quoteContext(updated));
}

export async function rejectQuote(auth, quoteId) {
  assertCustomer(auth);
  const quote = await loadQuote(quoteId);
  assertQuoteCustomer(auth, quote);

  const updated = await getDb().$transaction(async (tx) => {
    const current = await tx.quoteRequest.findUnique({ where: { id: quoteId } });
    if (!current || current.status !== "quoted") {
      throw badRequest("Only quoted requests can be rejected", "INVALID_STATUS");
    }
    return recordQuoteTransition(tx, {
      quoteId,
      fromStatus: current.status,
      toStatus: "rejected",
      actorUserId: auth.userId,
      note: "Customer rejected quotation",
      data: { resolvedAt: new Date() },
    });
  });

  // Notify expert that the customer rejected their quotation (non-fatal)
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const customerName = `${updated.customer.firstName ?? ""} ${updated.customer.lastName ?? ""}`.trim() || "A customer";
    await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
      userIds: [updated.expert.userId],
      type: "quote_rejected",
      title: "Quote Rejected",
      body: `${customerName} rejected your quote for "${updated.title}"`,
      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });
  } catch (err) {
    console.error(`[rejectQuote] Notification dispatch failed: ${err.message}`);
  }

  return toQuoteDetailDto(updated, quoteContext(updated));
}

export async function cancelQuote(auth, quoteId) {
  assertCustomer(auth);
  const quote = await loadQuote(quoteId);
  assertQuoteCustomer(auth, quote);

  const updated = await getDb().$transaction(async (tx) => {
    const current = await tx.quoteRequest.findUnique({ where: { id: quoteId } });
    if (!current || !CANCELLABLE_QUOTE_STATUSES.has(current.status)) {
      throw badRequest("Quote cannot be canceled in its current status", "INVALID_STATUS");
    }
    return recordQuoteTransition(tx, {
      quoteId,
      fromStatus: current.status,
      toStatus: "canceled",
      actorUserId: auth.userId,
      note: "Customer canceled quote request",
      data: { resolvedAt: new Date() },
    });
  });

  // Notify expert that the customer cancelled the quote request (non-fatal)
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const customerName = `${updated.customer.firstName ?? ""} ${updated.customer.lastName ?? ""}`.trim() || "A customer";
    await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
      userIds: [updated.expert.userId],
      type: "quote_cancelled",
      title: "Quote Request Cancelled",
      body: `${customerName} cancelled their quote request: "${updated.title}"`,
      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });
  } catch (err) {
    console.error(`[cancelQuote] Notification dispatch failed: ${err.message}`);
  }

  return toQuoteDetailDto(updated, quoteContext(updated));
}

export async function getQuoteHistory(auth, quoteId) {
  const quote = await loadQuote(quoteId);
  assertQuoteParticipant(auth, quote);

  const events = await getDb().quoteStatusEvent.findMany({
    where: { quoteId },
    orderBy: { createdAt: "asc" },
  });

  return toQuoteHistoryDto(quoteId, events);
}

// ─── Consultations ───────────────────────────────────────────────────────────

export async function createConsultation(auth, body) {
  assertCustomer(auth);
  const db = getDb();
  const expert = await db.expertProfile.findUnique({ where: { id: body.expertId } });
  if (!expert) throw notFound("Expert not found");

  // Guard: only allow consultations with verified, available experts
  if (expert.verificationStatus !== "approved") {
    throw badRequest("This expert is not yet verified and cannot accept consultations.", "EXPERT_NOT_VERIFIED");
  }
  if (expert.availabilityStatus !== "online") {
    throw badRequest("This expert is currently offline. Please try again when they are available.", "EXPERT_OFFLINE");
  }

  const consultation = await db.consultation.create({
    data: {
      customerId: auth.customerProfileId,
      expertId: body.expertId,
      status: "requested",
      ratePerMinuteCents: expert.consultationRateCents,
      zegoRoomId: `room-${crypto.randomUUID()}`,
    },
    include: CONSULTATION_INCLUDE,
  });

  // Notify expert of the incoming consultation request (non-fatal)
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const customerName = `${consultation.customer.firstName ?? ""} ${consultation.customer.lastName ?? ""}`.trim() || "A customer";
    await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
      userIds: [consultation.expert.userId],
      type: "consultation_requested",
      title: "Incoming Consultation Request",
      body: `${customerName} is requesting a consultation with you`,
      data: { consultationId: consultation.id },
    });
  } catch (err) {
    console.error(`[createConsultation] Notification dispatch failed: ${err.message}`);
  }

  return toConsultationDetailDto(consultation, consultationContext(consultation));
}

export async function listConsultations(auth, query) {
  const { page, limit, skip } = parsePagination(query);
  const where =
    auth.role === "expert"
      ? { expertId: auth.expertProfileId }
      : { customerId: auth.customerProfileId };

  if (auth.role === "expert" && !auth.expertProfileId) throw forbidden("Expert access required");
  if (auth.role === "customer" && !auth.customerProfileId) throw forbidden("Customer access required");

  if (query.status) where.status = query.status;

  const db = getDb();
  const [rows, total] = await Promise.all([
    db.consultation.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip,
      take: limit,
      include: CONSULTATION_INCLUDE,
    }),
    db.consultation.count({ where }),
  ]);

  const items = rows.map((c) => toConsultationSummaryDto(c, consultationContext(c)));
  return paginatedResult(items, { page, limit, total });
}

export async function getConsultation(auth, consultationId) {
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);
  return toConsultationDetailDto(consultation, consultationContext(consultation));
}

export async function acceptConsultation(auth, consultationId) {
  assertExpert(auth);
  // Pre-flight authorization check (status re-verified inside transaction)
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);

  const now = new Date();
  const db = getDb();
  const updated = await db.$transaction(async (tx) => {
    // Optimistic concurrency: only update if status is still valid
    const result = await tx.consultation.updateMany({
      where: { id: consultationId, status: { in: ["requested", "ringing"] } },
      data: {
        status: "in_progress",
        acceptedAt: now,
        startedAt: now,
      },
    });
    if (result.count === 0) {
      throw badRequest("Consultation is not awaiting acceptance", "INVALID_STATUS");
    }
    return tx.consultation.findUnique({
      where: { id: consultationId },
      include: CONSULTATION_INCLUDE,
    });
  });

  // Notify customer that the expert accepted their consultation (non-fatal)
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const expertName = `${updated.expert.firstName ?? ""} ${updated.expert.lastName ?? ""}`.trim() || "Your expert";
    await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
      userIds: [updated.customer.user.id],
      type: "consultation_accepted",
      title: "Consultation Accepted",
      body: `${expertName} accepted your consultation request`,
      data: { consultationId: updated.id },
    });
  } catch (err) {
    console.error(`[acceptConsultation] Notification dispatch failed: ${err.message}`);
  }

  return toConsultationDetailDto(updated, consultationContext(updated));
}

export async function declineConsultation(auth, consultationId) {
  assertExpert(auth);
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);

  const db = getDb();
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.consultation.updateMany({
      where: { id: consultationId, status: { in: ["requested", "ringing"] } },
      data: { status: "declined", endedAt: new Date() },
    });
    if (result.count === 0) {
      throw badRequest("Consultation is not awaiting a response", "INVALID_STATUS");
    }
    return tx.consultation.findUnique({
      where: { id: consultationId },
      include: CONSULTATION_INCLUDE,
    });
  });

  // Notify customer that the expert declined their consultation (non-fatal)
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const expertName = `${updated.expert.firstName ?? ""} ${updated.expert.lastName ?? ""}`.trim() || "Your expert";
    await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
      userIds: [updated.customer.user.id],
      type: "consultation_declined",
      title: "Consultation Declined",
      body: `${expertName} is currently unavailable and declined your request`,
      data: { consultationId: updated.id },
    });
  } catch (err) {
    console.error(`[declineConsultation] Notification dispatch failed: ${err.message}`);
  }

  return toConsultationDetailDto(updated, consultationContext(updated));
}

export async function endConsultation(auth, consultationId) {
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);

  const now = new Date();
  const startedAt = consultation.startedAt ?? consultation.acceptedAt ?? consultation.requestedAt;
  const durationSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
  const wasConnected = Boolean(consultation.startedAt);

  const db = getDb();
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.consultation.updateMany({
      where: {
        id: consultationId,
        status: { in: [...ACTIVE_CONSULTATION_STATUSES] },
      },
      data: {
        status: "completed",
        endedAt: now,
        durationSeconds,
        ...(consultation.startedAt ? {} : { startedAt }),
      },
    });
    if (result.count === 0) {
      throw badRequest("Consultation cannot be ended in its current status", "INVALID_STATUS");
    }
    return tx.consultation.findUnique({
      where: { id: consultationId },
      include: CONSULTATION_INCLUDE,
    });
  });

  // Trigger billing capture (same as ZegoCloud room_close webhook)
  if (wasConnected && durationSeconds > 0) {
    try {
      const billingUrl = process.env.BILLING_SERVICE_URL ?? "http://localhost:4006";
      await internalPost(
        billingUrl,
        `/api/v1/billing/consultations/${consultationId}/capture`,
        { durationSeconds }
      );
    } catch (err) {
      // Non-fatal — consultation is already marked completed; billing can be retried
      console.error(`[endConsultation] Billing capture failed: ${err.message}`);
    }
  }

  // Notify both parties that the consultation ended via API (non-fatal)
  // Note: the ZegoCloud room_close webhook handles this for calls ended via Zego.
  // This covers the manual end-via-API path only.
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    const durationLabel = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    const userIds = [
      updated.customer?.user?.id,
      updated.expert?.userId,
    ].filter(Boolean);
    if (userIds.length > 0) {
      await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds,
        type: "call_ended",
        title: "Consultation Ended",
        body: wasConnected
          ? `Your consultation has ended. Duration: ${durationLabel}.`
          : "Your consultation has ended.",
        data: { consultationId: updated.id },
      });
    }
  } catch (err) {
    console.error(`[endConsultation] Notification dispatch failed: ${err.message}`);
  }

  return toConsultationDetailDto(updated, consultationContext(updated));
}

export async function getVideoToken(auth, consultationId) {
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);
  if (!["accepted", "in_progress", "ringing"].includes(consultation.status)) {
    throw badRequest("Video is not available for this consultation", "INVALID_STATUS");
  }

  const zegoData = generateZegoToken(
    auth.userId,              // userID for the Zego token
    consultation.zegoRoomId,  // room they'll join
    3600                      // 1-hour validity
  );

  return toVideoTokenDto({
    token: zegoData.token,
    appID: zegoData.appID,
    roomId: zegoData.roomId,
    expiresAt: zegoData.expiresAt,
  });
}

export async function getBillingSummary(auth, consultationId) {
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);
  if (consultation.status !== "completed") {
    throw badRequest("Billing summary is available after consultation ends", "INVALID_STATUS");
  }

  // Fetch the charge breakdown from billing-service via internal HTTP call
  // instead of directly querying the billing DB (service boundary).
  const billingUrl = process.env.BILLING_SERVICE_URL ?? "http://localhost:4006";
  const charge = await internalGet(
    billingUrl,
    `/api/v1/billing/consultations/${consultationId}/charge`
  ).catch(() => null); // charge may not exist yet for legacy consultations

  return toConsultationBillingSummaryDto(consultation, {
    commissionCents: charge?.commissionCents ?? 0,
  });
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

export async function submitReview(auth, consultationId, body) {
  assertCustomer(auth);
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);
  if (consultation.status !== "completed") {
    throw badRequest("Reviews are allowed only after consultation completion", "INVALID_STATUS");
  }
  if (consultation.review) {
    throw conflict("Review already submitted", "REVIEW_EXISTS");
  }

  const db = getDb();

  const review = await db.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: {
        consultationId,
        customerId: auth.customerProfileId,
        expertId: consultation.expertId,
        rating: body.rating,
        comment: body.comment ?? null,
      },
    });

    // Atomically update rating using raw SQL — prevents the read-modify-write race
    // where two concurrent reviews both read the same ratingCount and overwrite each other.
    await tx.$executeRaw`
      UPDATE expert_profiles
      SET rating_count = rating_count + 1,
          rating_avg   = ROUND(((rating_avg * rating_count) + ${body.rating}::numeric) / (rating_count + 1), 2)
      WHERE id = ${consultation.expertId}::uuid
    `;

    return created;
  });

  // Notify the reviewed expert (non-fatal)
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const expertProfile = await getDb().expertProfile.findUnique({
      where: { id: consultation.expertId },
      select: { userId: true },
    });
    if (expertProfile?.userId) {
      const stars = "★".repeat(body.rating) + "☆".repeat(5 - body.rating);
      await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: [expertProfile.userId],
        type: "review_received",
        title: "New Review Received",
        body: `You received a ${body.rating}-star review ${stars}`,
        data: { consultationId, reviewId: review.id, rating: body.rating },
      });
    }
  } catch (err) {
    console.error(`[submitReview] Notification dispatch failed: ${err.message}`);
  }

  return toReviewDto(review);

}

export async function getPendingReviews(auth, query) {
  assertCustomer(auth);
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();

  const where = {
    customerId: auth.customerProfileId,
    status: "completed",
    review: null,
  };

  const [rows, total] = await Promise.all([
    db.consultation.findMany({
      where,
      orderBy: { endedAt: "desc" },
      skip,
      take: limit,
      include: CONSULTATION_INCLUDE,
    }),
    db.consultation.count({ where }),
  ]);

  const items = rows.map((c) => toConsultationSummaryDto(c, consultationContext(c)));
  return paginatedResult(items, { page, limit, total });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function createReport(auth, body) {
  assertCustomer(auth);
  const db = getDb();
  const expert = await db.expertProfile.findUnique({ where: { id: body.expertId } });
  if (!expert) throw notFound("Expert not found");

  const report = await db.expertReport.create({
    data: {
      customerId: auth.customerProfileId,
      expertId: body.expertId,
      reason: body.reason,
      details: body.details ?? null,
    },
  });

  return toExpertReportDto(report);
}
