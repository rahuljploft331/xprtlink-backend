import { getDb } from "@xprtlink/shared/db/index.js";
import { notFound } from "@xprtlink/shared/utils/errors.js";
import { sendEmail, renderEmailTemplate, escapeHtml, nl2br } from "@xprtlink/shared/lib/email.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
const log = logger.child({ module: "supportTicketService" });

/**
 * Submit a support request (forwards via email to admin).
 */
export async function createTicket(auth, { subject, body, category, referenceId, attachmentId, attachmentIds }) {
  const db = getDb();
  
  if (!subject) {
    subject = `Support Ticket - ${category}`;
  }

  // Deduplicate and collect all attachment IDs
  const allAttachmentIds = Array.from(
    new Set([
      ...(Array.isArray(attachmentIds) ? attachmentIds : []),
      ...(attachmentId ? [attachmentId] : []),
    ])
  ).filter(Boolean);

  let validAttachmentIds = [];
  if (allAttachmentIds.length > 0) {
    const existingMedia = await db.mediaAsset.findMany({
      where: { id: { in: allAttachmentIds } },
      select: { id: true },
    });
    const existingSet = new Set(existingMedia.map((m) => m.id));
    validAttachmentIds = allAttachmentIds.filter((id) => existingSet.has(id));
  }
  const primaryAttachmentId = validAttachmentIds[0] || null;
  
  // Get user details for the email
  const user = await db.user.findUnique({
    where: { id: auth.userId },
    include: { customerProfile: true, expertProfile: true }
  });
  const profile = user?.customerProfile || user?.expertProfile || {};
  const firstName = profile.firstName || '';
  const lastName = profile.lastName || '';

  // Get the support email from platform settings
  let supportEmail = "support@xpertlink.com";
  const setting = await db.platformSetting.findUnique({
    where: { key: "supportEmail" }
  });
  
  if (setting && setting.value) {
    supportEmail = setting.value; // Assuming value is the email string
  } else {
    if (typeof setting?.value === 'object' && setting.value.email) {
      supportEmail = setting.value.email;
    } else if (typeof setting?.value === 'string') {
      supportEmail = setting.value;
    }
  }

  const finalSubject = subject || `Support Ticket - ${category}`;
  
  const ticket = await db.supportTicket.create({
    data: {
      userId: auth.userId,
      subject: finalSubject,
      body,
      category,
      referenceId,
      attachmentId: primaryAttachmentId,
      status: "open",
      attachments: {
        create: validAttachmentIds.map((mediaId) => ({
          mediaId,
        })),
      },
    },
    include: {
      attachments: {
        include: {
          media: {
            select: { id: true, storageKey: true, mimeType: true },
          },
        },
      },
    },
  });

  // Send the email to support
  const userName = `${firstName} ${lastName}`.trim() || 'User';
  let attachmentText = "";
  let attachmentHtml = "";
  if (ticket.attachments && ticket.attachments.length > 0) {
    const list = ticket.attachments
      .map((att, idx) => `Attachment ${idx + 1}: ${att.media?.storageKey?.split("/").pop() || att.mediaId} (Key: ${att.media?.storageKey || 'N/A'})`)
      .join("\n");
    attachmentText = `\n\nAttachments (${ticket.attachments.length}):\n${list}`;
    const htmlList = ticket.attachments
      .map(
        (att, idx) =>
          `<li>Attachment ${idx + 1}: ${escapeHtml(att.media?.storageKey?.split("/").pop() || att.mediaId)} (${escapeHtml(att.media?.storageKey || 'N/A')})</li>`
      )
      .join("");
    attachmentHtml = `<p><strong>Attachments (${ticket.attachments.length}):</strong></p><ul>${htmlList}</ul>`;
  }

  const textBody = `New Support Request from ${userName} (${user?.email || 'No email'})\nCategory: ${category}${referenceId ? '\nReference ID: ' + referenceId : ''}\n\nSubject: ${finalSubject}\n\nMessage:\n${body}${attachmentText}`;
  
  try {
    const html = await renderEmailTemplate({
      title: "New Support Request",
      bodyHtml: `<p><strong>From:</strong> ${escapeHtml(userName)} (${escapeHtml(user?.email || "No email")})<br><strong>Category:</strong> ${escapeHtml(category)}${referenceId ? `<br><strong>Reference ID:</strong> ${escapeHtml(referenceId)}` : ""}</p><p><strong>Subject:</strong> ${escapeHtml(finalSubject)}</p><p><strong>Message:</strong><br>${nl2br(body)}</p>${attachmentHtml}`,
    });
    await sendEmail({
      to: supportEmail,
      subject: `[Support] ${finalSubject}`,
      text: textBody,
      html,
      replyTo: user?.email // Optional: allows support team to hit 'reply' directly
    });
  } catch (err) {
    log.error({ err: err.message }, "[supportTicketService] Failed to send email:");
    // Non-fatal, we still created the ticket record
  }

  return {
    ticketId: ticket.id,
    attachmentsCount: validAttachmentIds.length,
  };
}
