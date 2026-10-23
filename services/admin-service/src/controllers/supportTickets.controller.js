import { getDb } from "@xprtlink/shared/db/index.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { notFound, badRequest } from "@xprtlink/shared/utils/errors.js";
import { sendEmail, renderEmailTemplate, escapeHtml, nl2br } from "@xprtlink/shared/lib/email.js";
import { generatePresignedDownloadUrl } from "@xprtlink/shared/utils/s3.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { resolveMediaUrl } from "@xprtlink/shared/mappers/common.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
const log = logger.child({ module: "supportTickets.controller" });

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
    if (role === "expert") {
      where.user = { expertProfile: { isNot: null } };
    } else if (role === "customer") {
      where.user = { customerProfile: { isNot: null } };
    }
  }

  const [total, items] = await Promise.all([
    db.supportTicket.count({ where }),
    db.supportTicket.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, email: true, customerProfile: { select: { firstName: true, lastName: true, avatarMedia: { select: { storageKey: true } } } }, expertProfile: { select: { firstName: true, lastName: true, avatarMedia: { select: { storageKey: true } } } } } },
        attachment: { select: { id: true, storageKey: true, mimeType: true, sizeBytes: true } },
        attachments: {
          include: {
            media: { select: { id: true, storageKey: true, mimeType: true, sizeBytes: true } }
          }
        }
      }
    })
  ]);

  const formattedItems = await Promise.all(items.map(async ticket => {
    const profile = ticket.user?.customerProfile || ticket.user?.expertProfile || {};
    const role = ticket.user?.expertProfile ? "expert" : "customer";
    
    const attachments = await Promise.all(
      (ticket.attachments || []).map(async (att) => {
        const media = att.media;
        if (!media) return null;
        let url = null;
        if (media.storageKey) {
          try {
            url = await generatePresignedDownloadUrl(media.storageKey);
          } catch (e) {
            log.warn({ err: e.message, storageKey: media.storageKey }, "Failed generating presigned download URL");
          }
        }
        return {
          id: media.id,
          url,
          mimeType: media.mimeType,
          fileName: media.storageKey?.split("/").pop() ?? null,
          sizeBytes: media.sizeBytes,
        };
      })
    ).then((list) => list.filter(Boolean));

    if (attachments.length === 0 && ticket.attachment) {
      let url = null;
      if (ticket.attachment.storageKey) {
        try {
          url = await generatePresignedDownloadUrl(ticket.attachment.storageKey);
        } catch (_) {}
      }
      attachments.push({
        id: ticket.attachment.id,
        url,
        mimeType: ticket.attachment.mimeType,
        fileName: ticket.attachment.storageKey?.split("/").pop() ?? null,
        sizeBytes: ticket.attachment.sizeBytes,
      });
    }

    const mappedTicket = {
      ...ticket,
      user: {
        id: ticket.user?.id,
        email: ticket.user?.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
      avatarUrl: resolveMediaUrl(profile.avatarMedia?.storageKey),
        role: role
      },
      attachments,
      attachment: attachments[0] || null,
    };
    
    return mappedTicket;
  }));

  return ResponseFormatter.success(res, {
    data: formattedItems,
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
  const { message, action } = req.body;

  if (!message && action !== "close") {
    throw badRequest("replyMessageRequired");
  }

  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: { user: { include: { customerProfile: true, expertProfile: true } } }
  });

  if (!ticket) {
    throw notFound("supportTicketNotFound");
  }

  const isClosing = action === "close";
  const updatedTicket = await db.supportTicket.update({
    where: { id },
    data: {
      status: isClosing ? "closed" : "in_progress",
      ...(message ? { resolutionNote: message } : {}),
      ...(isClosing ? { resolvedAt: new Date() } : {})
    }
  });

  if (message) {
    // Send email to the user
    const user = ticket.user;
    const profile = user?.customerProfile || user?.expertProfile || {};
    const userName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'User';
    
    const textBody = `Hi ${userName},\n\nYour support ticket regarding "${ticket.subject || ticket.category}" has been updated.\n\nReply from Admin:\n${message}\n\nBest regards,\nXprtLink Support Team`;

    try {
      const html = await renderEmailTemplate({
        title: "Support Ticket Update",
        bodyHtml: `<p>Hi ${escapeHtml(userName)},</p><p>Your support ticket regarding "${escapeHtml(ticket.subject || ticket.category)}" has been updated.</p><p><strong>Reply from Admin:</strong><br>${nl2br(message)}</p><p>Best regards,<br>XprtLink Support Team</p>`,
      });
      await sendEmail({ category: "support",
        to: user.email,
        subject: `Re: [Support] ${ticket.subject || ticket.category}`,
        text: textBody,
        html,
      });
    } catch (err) {
      log.error({ err: err.message }, "[supportTickets.controller] Failed to send email:");
    }
  }

  return ResponseFormatter.success(res, {
    message: getMessage("updatedSuccessfully"),
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
      user: { select: { id: true, email: true, customerProfile: { select: { firstName: true, lastName: true, avatarMedia: { select: { storageKey: true } } } }, expertProfile: { select: { firstName: true, lastName: true, avatarMedia: { select: { storageKey: true } } } } } },
      attachment: { select: { id: true, storageKey: true, mimeType: true, sizeBytes: true } },
      attachments: {
        include: {
          media: { select: { id: true, storageKey: true, mimeType: true, sizeBytes: true } }
        }
      }
    }
  });

  if (!ticket) {
    throw notFound("supportTicketNotFound");
  }

  const profile = ticket.user?.customerProfile || ticket.user?.expertProfile || {};
  const role = ticket.user?.expertProfile ? "expert" : "customer";
  
  const attachments = await Promise.all(
    (ticket.attachments || []).map(async (att) => {
      const media = att.media;
      if (!media) return null;
      let url = null;
      if (media.storageKey) {
        try {
          url = await generatePresignedDownloadUrl(media.storageKey);
        } catch (e) {
          log.warn({ err: e.message, storageKey: media.storageKey }, "Failed generating presigned download URL");
        }
      }
      return {
        id: media.id,
        url,
        mimeType: media.mimeType,
        fileName: media.storageKey?.split("/").pop() ?? null,
        sizeBytes: media.sizeBytes,
      };
    })
  ).then((list) => list.filter(Boolean));

  if (attachments.length === 0 && ticket.attachment) {
    let url = null;
    if (ticket.attachment.storageKey) {
      try {
        url = await generatePresignedDownloadUrl(ticket.attachment.storageKey);
      } catch (_) {}
    }
    attachments.push({
      id: ticket.attachment.id,
      url,
      mimeType: ticket.attachment.mimeType,
      fileName: ticket.attachment.storageKey?.split("/").pop() ?? null,
      sizeBytes: ticket.attachment.sizeBytes,
    });
  }

  const mappedTicket = {
    ...ticket,
    user: {
      id: ticket.user?.id,
      email: ticket.user?.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      avatarUrl: resolveMediaUrl(profile.avatarMedia?.storageKey),
      role: role
    },
    attachments,
    attachment: attachments[0] || null,
  };
  
  return ResponseFormatter.success(res, { data: mappedTicket });
}
