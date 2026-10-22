import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getSecretSync } from "../config/secrets.js";
import { badRequest } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
const log = logger.child({ module: "email" });

function isDevFallbackEnabled() {
  return process.env.NODE_ENV !== "production";
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Escape user-supplied text before placing it inside an email body. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Escape text and keep its line breaks. */
export function nl2br(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

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
  const templatePath = path.join(__dirname, "../templates/base-email.hbs");
  let html = await fs.readFile(templatePath, "utf-8");

  html = html.replace(/{{TITLE}}/g, () => title || "");
  html = html.replace(/{{BODY_HTML}}/g, () => bodyHtml || "");

  if (badgeText) {
    html = html.replace(/{{SHOW_BADGE}}/g, () => "table");
    html = html.replace(/{{BADGE_TEXT}}/g, () => badgeText);
  } else {
    html = html.replace(/{{SHOW_BADGE}}/g, () => "none");
    html = html.replace(/{{BADGE_TEXT}}/g, () => "");
  }

  if (ctaText && ctaUrl) {
    html = html.replace(/{{SHOW_CTA}}/g, () => "table-cell");
    html = html.replace(/{{CTA_TEXT}}/g, () => ctaText);
    html = html.replace(/{{CTA_URL}}/g, () => ctaUrl);
  } else {
    // Blank the hidden button too: some email clients ignore display:none and
    // would otherwise show a literal "{{CTA_TEXT}}" button.
    html = html.replace(/{{SHOW_CTA}}/g, () => "none");
    html = html.replace(/{{CTA_TEXT}}/g, () => "");
    html = html.replace(/{{CTA_URL}}/g, () => "#");
  }

  if (bottomNoteHtml) {
    html = html.replace(/{{SHOW_BOTTOM_NOTE}}/g, () => "table-cell");
    html = html.replace(/{{BOTTOM_NOTE_HTML}}/g, () => bottomNoteHtml);
  } else {
    html = html.replace(/{{SHOW_BOTTOM_NOTE}}/g, () => "none");
    html = html.replace(/{{BOTTOM_NOTE_HTML}}/g, () => "");
  }

  return html;
}

/** Persist one email attempt. Never throws — logging must not break delivery. */
async function recordEmailLog(entry) {
  try {
    if (!process.env.DATABASE_URL) return;
    const { getDb } = await import("../db/getClient.js");
    await getDb().emailLog.create({
      data: { ...entry, service: process.env.SERVICE_NAME || null },
    });
  } catch (err) {
    log.warn(`[email] failed to write email log: ${err?.message}`);
  }
}

/**
 * Send a transactional email via SendGrid.
 * Falls back to console logging in non-production when SENDGRID_API_KEY isn't configured.
 * Every attempt is written to `email_logs` (admin portal → Email Logs).
 * `category` groups mails in that view; `sensitive` skips storing the body (OTP codes etc.).
 */
export async function sendEmail({ to, subject, text, html, replyTo, category = "general", sensitive = false }) {
  const apiKey = getSecretSync("SENDGRID_API_KEY");
  const fromEmail = getSecretSync("SENDGRID_FROM_EMAIL", "noreply@xpertlink.local");
  const base = {
    toEmail: Array.isArray(to) ? to.join(", ") : String(to ?? ""),
    fromEmail,
    subject: subject ?? "",
    category,
    htmlBody: sensitive ? null : html ?? null,
    textBody: sensitive ? null : text ?? null,
  };

  if (!apiKey) {
    if (isDevFallbackEnabled()) {
      log.info(`[email] to ${to}: ${subject}\n${text}`);
      await recordEmailLog({ ...base, status: "skipped", provider: "console" });
      return;
    }
    await recordEmailLog({ ...base, status: "failed", errorMessage: "SENDGRID_API_KEY not configured" });
    throw badRequest("emailDeliveryFailed", "EMAIL_DELIVERY_FAILED");
  }

  const { default: sgMail } = await import("@sendgrid/mail");
  sgMail.setApiKey(apiKey);

  const msg = { to, from: fromEmail, subject, text, html };
  if (replyTo) msg.replyTo = replyTo;
  try {
    const [response] = await sgMail.send(msg);
    await recordEmailLog({
      ...base,
      status: "sent",
      providerMessageId: response?.headers?.["x-message-id"] ?? null,
    });
  } catch (err) {
    const detail = err?.response?.body?.errors?.map((e) => e.message).join("; ");
    await recordEmailLog({
      ...base,
      status: "failed",
      errorMessage: String(detail || err?.message || "Unknown error").slice(0, 2000),
    });
    throw err;
  }
}
