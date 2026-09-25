/**
 * consultationInvoice.js
 *
 * Builds the soft-copy (HTML) invoice emailed to both parties when a
 * consultation is charged:
 *   - Customer receives a "receipt" — the DEBIT (amount charged to their card).
 *   - Expert receives an "earnings statement" — the CREDIT (net amount added to
 *     their earnings balance, after platform commission).
 *
 * The figures here must reconcile exactly with what captureConsultation() wrote
 * to the ledger (Transaction.amountCents, ConsultationCharge.commissionCents /
 * expertShareCents), so this module RECEIVES those cents values rather than
 * recomputing them.
 *
 * No PDF / downloadable attachment — HTML email body only.
 */

import { getMessage } from "../utils/messages.js";
import { renderEmailTemplate } from "./email.js";
import { consultationBillableMinutes, perMinuteCentsFromListedRate } from "./consultationBilling.js";

/** Short human-friendly invoice reference derived from the consultation id, e.g. INV-37535A. */
export function invoiceReference(consultationId) {
  const hex = String(consultationId ?? "").replace(/-/g, "");
  return `INV-${hex.slice(-6).toUpperCase()}`;
}

/** Format integer cents as a currency string, e.g. 6700 -> "$67.00" (USD) / "67.00 EUR". */
function formatMoney(cents, currency = "USD") {
  const amount = (Number(cents ?? 0) / 100).toFixed(2);
  return currency === "USD" ? `$${amount}` : `${amount} ${currency}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One line-item row for the invoice table. */
function row(label, value, { bold = false, muted = false } = {}) {
  const weight = bold ? "600" : "400";
  const color = muted ? "#b9cbd4" : "#f6fbff";
  return `
    <tr>
      <td style="padding: 10px 0; font-family: 'Outfit', Arial, sans-serif; font-size: 14px; font-weight: ${weight}; color: ${color}; text-align: left;">${label}</td>
      <td style="padding: 10px 0; font-family: 'Outfit', Arial, sans-serif; font-size: 14px; font-weight: ${weight}; color: ${color}; text-align: right; white-space: nowrap;">${value}</td>
    </tr>`;
}

function divider() {
  return `
    <tr>
      <td colspan="2" style="padding: 0;">
        <div style="height: 1px; background: rgba(255,255,255,0.10); margin: 6px 0;"></div>
      </td>
    </tr>`;
}

/**
 * Build the left-aligned invoice detail table that goes inside the template's
 * BODY_HTML slot. `rowsHtml` is a pre-composed string of <tr> rows.
 */
function invoiceTable({ reference, dateLabel, rowsHtml }) {
  return `
    <div style="text-align: left; margin-top: 8px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 0 0 4px 0; font-family: 'Outfit', Arial, sans-serif; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #6a8291; text-align: left;">Reference</td>
          <td style="padding: 0 0 4px 0; font-family: 'Outfit', Arial, sans-serif; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #6a8291; text-align: right;">Date</td>
        </tr>
        <tr>
          <td style="padding: 0 0 18px 0; font-family: 'Outfit', Arial, sans-serif; font-size: 14px; font-weight: 600; color: #f6fbff; text-align: left;">${escapeHtml(reference)}</td>
          <td style="padding: 0 0 18px 0; font-family: 'Outfit', Arial, sans-serif; font-size: 14px; font-weight: 600; color: #f6fbff; text-align: right;">${escapeHtml(dateLabel)}</td>
        </tr>
      </table>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 4px 16px;">
        ${rowsHtml}
      </table>
    </div>`;
}

/**
 * Assemble the invoice data + rendered HTML + subject for ONE party.
 *
 * @param {object} args
 * @param {"customer"|"expert"} args.audience  Who this copy is for.
 * @param {object} args.consultation           Consultation row (needs ratePerMinuteCents, durationSeconds).
 * @param {number} args.amountCents            Gross customer charge (debit).
 * @param {number} args.commissionCents        Platform commission.
 * @param {number} args.expertShareCents       Expert net credit.
 * @param {string} args.currency               ISO currency, e.g. "USD".
 * @param {string} args.expertName
 * @param {string} args.customerName
 * @param {Date}   [args.issuedAt]             Defaults to now.
 * @returns {Promise<{ subject: string, html: string }>}
 */
export async function buildConsultationInvoiceEmail({
  audience,
  consultation,
  amountCents,
  commissionCents,
  expertShareCents,
  currency = "USD",
  expertName,
  customerName,
  issuedAt = new Date(),
}) {
  const reference = invoiceReference(consultation.id);
  const dateLabel = issuedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const minutes = consultationBillableMinutes(consultation.durationSeconds);
  const perMinuteCents = perMinuteCentsFromListedRate(consultation.ratePerMinuteCents);
  const minuteLabel = minutes === 1 ? "1 minute" : `${minutes} minutes`;

  const isCustomer = audience === "customer";

  const badge = getMessage(isCustomer ? "invoiceBadgeCustomer" : "invoiceBadgeExpert");
  const title = getMessage(isCustomer ? "invoiceTitleCustomer" : "invoiceTitleExpert");
  const intro = isCustomer
    ? getMessage("invoiceCustomerIntro", { expertName: expertName || "your expert" })
    : getMessage("invoiceExpertIntro", { customerName: customerName || "your customer" });
  const subject = isCustomer
    ? getMessage("invoiceEmailSubjectCustomer", { reference })
    : getMessage("invoiceEmailSubjectExpert", { reference });

  let rowsHtml;
  if (isCustomer) {
    // Customer view — the DEBIT. Show what they were billed.
    rowsHtml = [
      row(`Consultation with ${escapeHtml(expertName || "Expert")}`, "", { muted: true }),
      row(`Duration (${minuteLabel})`, `${formatMoney(perMinuteCents, currency)}/min`, { muted: true }),
      divider(),
      row("Amount charged", formatMoney(amountCents, currency), { bold: true }),
    ].join("");
  } else {
    // Expert view — the CREDIT. Show gross, commission deduction, and net.
    rowsHtml = [
      row(`Consultation with ${escapeHtml(customerName || "Customer")}`, "", { muted: true }),
      row(`Duration (${minuteLabel})`, `${formatMoney(perMinuteCents, currency)}/min`, { muted: true }),
      divider(),
      row("Gross amount", formatMoney(amountCents, currency), { muted: true }),
      row("Platform commission", `- ${formatMoney(commissionCents, currency)}`, { muted: true }),
      divider(),
      row("Net earnings credited", formatMoney(expertShareCents, currency), { bold: true }),
    ].join("");
  }

  const bodyHtml = `
    <p style="margin: 0 0 24px 0;">${intro}</p>
    ${invoiceTable({ reference, dateLabel, rowsHtml })}`;

  const html = await renderEmailTemplate({
    title,
    bodyHtml,
    badgeText: badge,
    bottomNoteHtml: getMessage("invoiceFooterNote", { currency }),
  });

  return { subject, html };
}
