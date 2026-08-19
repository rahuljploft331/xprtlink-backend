import { getSecretSync } from "../config/secrets.js";
import { badRequest } from "../utils/errors.js";

function isDevFallbackEnabled() {
  return process.env.NODE_ENV !== "production";
}

/**
 * Send a transactional email via SendGrid.
 * Falls back to console logging in non-production when SENDGRID_API_KEY isn't configured.
 */
export async function sendEmail({ to, subject, text, html }) {
  const apiKey = getSecretSync("SENDGRID_API_KEY");
  const fromEmail = getSecretSync("SENDGRID_FROM_EMAIL", "noreply@xpertlink.local");

  if (!apiKey) {
    if (isDevFallbackEnabled()) {
      console.log(`[email] to ${to}: ${subject}\n${text}`);
      return;
    }
    throw badRequest("Unable to send email. Please try again.", "EMAIL_DELIVERY_FAILED");
  }

  const { default: sgMail } = await import("@sendgrid/mail");
  sgMail.setApiKey(apiKey);

  await sgMail.send({ to, from: fromEmail, subject, text, html });
}
