import { getDb } from "@xprtlink/shared/db";
import { notFound } from "@xprtlink/shared/utils/errors.js";

/**
 * Create a new support ticket for the authenticated user.
 */
export async function createTicket(auth, { subject, body, category }) {
  const db = getDb();
  const ticket = await db.supportTicket.create({
    data: {
      userId: auth.userId,
      subject,
      body,
      category,
    },
  });
  return toTicketDto(ticket);
}

/**
 * List all tickets for the authenticated user with optional status filter.
 */
export async function listMyTickets(auth, { status, page, limit }) {
  const db = getDb();
  const where = { userId: auth.userId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    db.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.supportTicket.count({ where }),
  ]);

  return { items: items.map(toTicketDto), page, limit, total };
}

/**
 * Get a single ticket by ID, verifying ownership.
 */
export async function getTicket(auth, ticketId) {
  const db = getDb();
  const ticket = await db.supportTicket.findFirst({
    where: { id: ticketId, userId: auth.userId },
  });
  if (!ticket) throw notFound("Support ticket not found");
  return toTicketDto(ticket);
}

// ── DTO mapper ───────────────────────────────────────────────────────────────

function toTicketDto(t) {
  return {
    id: t.id,
    subject: t.subject,
    body: t.body,
    category: t.category,
    status: t.status,
    resolutionNote: t.resolutionNote ?? null,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
