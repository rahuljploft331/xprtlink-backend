import { getDb } from "@xprtlink/shared/db/index.js";
import { notFound } from "@xprtlink/shared/utils/errors.js";
import { sendEmail } from "@xprtlink/shared/lib/email.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
const log = logger.child({ module: "supportTicketService" });

/**
 * Submit a support request (forwards via email to admin).
 */
export async function createTicket(auth, { subject, body, category, referenceId, attachmentId }) {
  const db = getDb();
  
  if (!subject) {
    subject = `Support Ticket - ${category}`;
  }
  
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
    // If setting is stored as a JSON object, might need to parse. But usually it's just a string in JSON.
    // Let's handle if it's an object { email: '...' } just in case.
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
      attachmentId,
      status: "open",
    },
  });

  // Send the email to support
  const userName = `${firstName} ${lastName}`.trim() || 'User';
  let attachmentUrl = "";
  if (attachmentId) {
    const media = await db.mediaAsset.findUnique({ where: { id: attachmentId } });
    if (media) {
      attachmentUrl = `\n\nAttachment ID: ${media.id} (Key: ${media.storageKey})`;
    }
  }

  const textBody = `New Support Request from ${userName} (${user?.email || 'No email'})\nCategory: ${category}${referenceId ? '\nReference ID: ' + referenceId : ''}\n\nSubject: ${finalSubject}\n\nMessage:\n${body}${attachmentUrl}`;
  
  try {
    await sendEmail({
      to: supportEmail,
      subject: `[Support] ${finalSubject}`,
      text: textBody,
      html: textBody.replace(/\n/g, "<br>"),
      replyTo: user?.email // Optional: allows support team to hit 'reply' directly
    });
  } catch (err) {
    log.error({ err: err.message }, "[supportTicketService] Failed to send email:");
    // Non-fatal, we still created the ticket record
  }

  return { success: true, message: getMessage("ticketForwardedToSupport") };
}
