import crypto from "crypto";
import { generateZegoToken } from "@xprtlink/shared/lib/zegoToken.js";
import { getDb } from "@xprtlink/shared/db";
import { internalGet } from "@xprtlink/shared/lib/internalFetch.js";
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
  customer: { include: { user: true } },
  expert: true,
  attachments: { include: { media: true } },
};

const CONSULTATION_INCLUDE = {
  customer: { include: { user: true } },
  expert: true,
  review: true,
};

const EDITABLE_QUOTE_STATUSES = new Set(["draft", "submitted", "pending_expert_review"]);
const CANCELLABLE_QUOTE_STATUSES = new Set(["draft", "submitted", "pending_expert_review"]);
const ACTIVE_CONSULTATION_STATUSES = new Set(["requested", "ringing", "accepted", "in_progress"]);

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
    expertProfile: quote.expert,
    attachments: quote.attachments ?? [],
    currency: quote.expert.currency,
  };
}

function consultationContext(consultation) {
  return {
    customerUser: consultation.customer.user,
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
    expert = await db.expertProfile.findFirst({ where: { id: body.expertId } });
  }
  if (!expert) {
    expert = (await db.expertProfile.findFirst({ where: { verificationStatus: "approved" } })) || (await db.expertProfile.findFirst());
  }
  if (!expert) throw notFound("No expert profile found in system");

  const now = new Date();
  const quote = await db.$transaction(async (tx) => {
    const created = await tx.quoteRequest.create({
      data: {
        customerId: auth.customerProfileId,
        expertId: expert.id,
        title: body.title,
        description: body.description,
        budgetCents: amountToCents(body.budget),
        status: "submitted",
        submittedAt: now,
      },
      include: QUOTE_INCLUDE,
    });

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

  return toQuoteDetailDto(quote, quoteContext(quote));
}

export async function updateQuote(auth, quoteId, body) {
  const quote = await loadQuote(quoteId);
  assertQuoteCustomer(auth, quote);
  if (!EDITABLE_QUOTE_STATUSES.has(quote.status)) {
    throw badRequest("Quote cannot be edited in its current status", "INVALID_STATUS");
  }

  const db = getDb();
  const updated = await db.$transaction(async (tx) => {
    const data = {
      ...(body.title ? { title: body.title } : {}),
      ...(body.description ? { description: body.description } : {}),
      ...(body.budget !== undefined ? { budgetCents: amountToCents(body.budget) } : {}),
    };

    if (body.mediaIds?.length) {
      await tx.quoteAttachment.createMany({
        data: body.mediaIds.map((mediaId) => ({ quoteId, mediaId })),
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
      where.status = "pending_expert_review";
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
  return toQuoteDetailDto(quote, quoteContext(quote));
}

export async function submitQuotation(auth, quoteId, body) {
  assertExpert(auth);
  const quote = await loadQuote(quoteId);
  assertQuoteExpert(auth, quote);
  if (quote.status !== "pending_expert_review") {
    throw badRequest("Quote is not awaiting a quotation", "INVALID_STATUS");
  }

  const now = new Date();
  const updated = await getDb().$transaction((tx) =>
    recordQuoteTransition(tx, {
      quoteId,
      fromStatus: quote.status,
      toStatus: "quoted",
      actorUserId: auth.userId,
      note: body.notes ?? "Expert quotation submitted",
      data: {
        expertQuoteAmountCents: amountToCents(body.amount),
        expertQuoteNotes: body.notes ?? null,
        quotedAt: now,
      },
    })
  );

  return toQuoteDetailDto(updated, quoteContext(updated));
}

export async function acceptQuote(auth, quoteId) {
  assertCustomer(auth);
  const quote = await loadQuote(quoteId);
  assertQuoteCustomer(auth, quote);
  if (quote.status !== "quoted") {
    throw badRequest("Only quoted requests can be accepted", "INVALID_STATUS");
  }

  const updated = await getDb().$transaction((tx) =>
    recordQuoteTransition(tx, {
      quoteId,
      fromStatus: quote.status,
      toStatus: "accepted",
      actorUserId: auth.userId,
      note: "Customer accepted quotation",
      data: { resolvedAt: new Date() },
    })
  );

  return toQuoteDetailDto(updated, quoteContext(updated));
}

export async function rejectQuote(auth, quoteId) {
  assertCustomer(auth);
  const quote = await loadQuote(quoteId);
  assertQuoteCustomer(auth, quote);
  if (quote.status !== "quoted") {
    throw badRequest("Only quoted requests can be rejected", "INVALID_STATUS");
  }

  const updated = await getDb().$transaction((tx) =>
    recordQuoteTransition(tx, {
      quoteId,
      fromStatus: quote.status,
      toStatus: "rejected",
      actorUserId: auth.userId,
      note: "Customer rejected quotation",
      data: { resolvedAt: new Date() },
    })
  );

  return toQuoteDetailDto(updated, quoteContext(updated));
}

export async function cancelQuote(auth, quoteId) {
  assertCustomer(auth);
  const quote = await loadQuote(quoteId);
  assertQuoteCustomer(auth, quote);
  if (!CANCELLABLE_QUOTE_STATUSES.has(quote.status)) {
    throw badRequest("Quote cannot be canceled in its current status", "INVALID_STATUS");
  }

  const updated = await getDb().$transaction((tx) =>
    recordQuoteTransition(tx, {
      quoteId,
      fromStatus: quote.status,
      toStatus: "canceled",
      actorUserId: auth.userId,
      note: "Customer canceled quote request",
      data: { resolvedAt: new Date() },
    })
  );

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
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);
  if (!["requested", "ringing"].includes(consultation.status)) {
    throw badRequest("Consultation is not awaiting acceptance", "INVALID_STATUS");
  }

  const now = new Date();
  const updated = await getDb().consultation.update({
    where: { id: consultationId },
    data: {
      status: "in_progress",
      acceptedAt: now,
      startedAt: now,
    },
    include: CONSULTATION_INCLUDE,
  });

  return toConsultationDetailDto(updated, consultationContext(updated));
}

export async function declineConsultation(auth, consultationId) {
  assertExpert(auth);
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);
  if (!["requested", "ringing"].includes(consultation.status)) {
    throw badRequest("Consultation is not awaiting a response", "INVALID_STATUS");
  }

  const updated = await getDb().consultation.update({
    where: { id: consultationId },
    data: { status: "declined", endedAt: new Date() },
    include: CONSULTATION_INCLUDE,
  });

  return toConsultationDetailDto(updated, consultationContext(updated));
}

export async function endConsultation(auth, consultationId) {
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);
  if (!ACTIVE_CONSULTATION_STATUSES.has(consultation.status)) {
    throw badRequest("Consultation cannot be ended in its current status", "INVALID_STATUS");
  }

  const now = new Date();
  const startedAt = consultation.startedAt ?? consultation.acceptedAt ?? consultation.requestedAt;
  const durationSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));

  const updated = await getDb().consultation.update({
    where: { id: consultationId },
    data: {
      status: "completed",
      endedAt: now,
      durationSeconds,
      ...(consultation.startedAt ? {} : { startedAt }),
    },
    include: CONSULTATION_INCLUDE,
  });

  return toConsultationDetailDto(updated, consultationContext(updated));
}

export async function getVideoToken(auth, consultationId) {
  const consultation = await loadConsultation(consultationId);
  assertConsultationParticipant(auth, consultation);
  if (!["accepted", "in_progress", "ringing", "requested"].includes(consultation.status)) {
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

    // Atomically update rating using a single query — avoids the read-modify-write race
    // condition where two concurrent reviews both read the same ratingCount and overwrite each other.
    const expert = await tx.expertProfile.findUnique({
      where: { id: consultation.expertId },
      select: { ratingCount: true, ratingAvg: true },
    });

    if (expert) {
      const newCount = expert.ratingCount + 1;
      const newAvg = (Number(expert.ratingAvg) * expert.ratingCount + body.rating) / newCount;
      await tx.expertProfile.update({
        where: { id: consultation.expertId },
        data: {
          ratingCount: { increment: 1 },
          ratingAvg: newAvg.toFixed(2),
        },
      });
    }

    return created;
  });

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
