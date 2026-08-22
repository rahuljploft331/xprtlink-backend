import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getSecretSync } from "../config/secrets.js";
import { badRequest } from "../utils/errors.js";

function isDevFallbackEnabled() {
  return process.env.NODE_ENV !== "production";
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Render the base email template with provided variables.
 */
export async function renderEmailTemplate({
  title,
  bodyHtml,
  badgeText = null,
  ctaText = null,
  ctaUrl = null,
  bottomNoteHtml = null,
}) {
  const templatePath = path.join(__dirname, "../templates/base-email.html");
  let html = await fs.readFile(templatePath, "utf-8");

  html = html.replace(/{{TITLE}}/g, title || "");
  html = html.replace(/{{BODY_HTML}}/g, bodyHtml || "");
  
  if (badgeText) {
    html = html.replace(/{{SHOW_BADGE}}/g, "table");
    html = html.replace(/{{BADGE_TEXT}}/g, badgeText);
  } else {
    html = html.replace(/{{SHOW_BADGE}}/g, "none");
  }

  if (ctaText && ctaUrl) {
    html = html.replace(/{{SHOW_CTA}}/g, "table-cell");
    html = html.replace(/{{CTA_TEXT}}/g, ctaText);
    html = html.replace(/{{CTA_URL}}/g, ctaUrl);
  } else {
    html = html.replace(/{{SHOW_CTA}}/g, "none");
  }

  if (bottomNoteHtml) {
    html = html.replace(/{{SHOW_BOTTOM_NOTE}}/g, "table-cell");
    html = html.replace(/{{BOTTOM_NOTE_HTML}}/g, bottomNoteHtml);
  } else {
    html = html.replace(/{{SHOW_BOTTOM_NOTE}}/g, "none");
  }

  return html;
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
