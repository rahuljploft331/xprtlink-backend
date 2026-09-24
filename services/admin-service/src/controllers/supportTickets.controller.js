import { getDb } from "@xprtlink/shared/db/index.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { notFound, badRequest } from "@xprtlink/shared/utils/errors.js";
import { sendEmail } from "@xprtlink/shared/lib/email.js";

/**
 * List support tickets (admin view).
 * Filters: role (expert|customer), status (open|closed), etc.
 */
export async function list(req, res) {
  const db = getDb();
  const { page = 1, limit = 20, role, status } = req.query;

  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);

  const where = {};
  if (status) {
    where.status = status;
  }
  if (role) {
    where.user = { role };
  }

  const [total, items] = await Promise.all([
    db.supportTicket.count({ where }),
    db.supportTicket.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        attachment: { select: { id: true, url: true } }
      }
    })
  ]);

  return ResponseFormatter.success(res, {
    data: items,
    meta: { total, page: Number(page), limit: Number(limit) }
  });
}

/**
 * Reply to a support ticket.
 * Sets resolutionNote, changes status to 'resolved', and sends an email.
 */
export async function reply(req, res) {
  const db = getDb();
  const { id } = req.params;
  const { message } = req.body;

  if (!message) {
    throw badRequest("replyMessageRequired");
  }

  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: { user: true }
  });

  if (!ticket) {
    throw notFound("supportTicketNotFound");
  }

  const updatedTicket = await db.supportTicket.update({
    where: { id },
    data: {
      status: "closed",
      resolutionNote: message,
      resolvedAt: new Date()
    }
  });

  // Send email to the user
  const user = ticket.user;
  const userName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'User';
  
  const textBody = `Hi ${userName},\n\nYour support ticket regarding "${ticket.subject || ticket.category}" has been updated.\n\nReply from Admin:\n${message}\n\nBest regards,\nXprtLink Support Team`;

  try {
    await sendEmail({
      to: user.email,
      subject: `Re: [Support] ${ticket.subject || ticket.category}`,
      text: textBody,
      html: textBody.replace(/\n/g, "<br>")
    });
  } catch (err) {
    console.error("[supportTickets.controller] Failed to send email:", err.message);
  }

  return ResponseFormatter.success(res, {
    message: "Reply sent successfully",
    data: updatedTicket
  });
}

/**
 * Get ticket by ID
 */
export async function getById(req, res) {
  const db = getDb();
  const { id } = req.params;

  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      attachment: { select: { id: true, url: true } }
    }
  });

  if (!ticket) {
    throw notFound("supportTicketNotFound");
  }

  return ResponseFormatter.success(res, { data: ticket });
}
