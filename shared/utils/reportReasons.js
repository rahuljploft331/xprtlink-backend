import { AppError } from "./errors.js";

/**
 * One reason list for every user report (customer -> expert from the profile or
 * from chat, expert -> customer from chat). The selected entry is stored
 * verbatim as `reason`; free text for "Other" goes in `details`.
 */
export const REPORT_REASONS = [
  "Inappropriate behavior",
  "Spam or scam",
  "Fake profile",
  "Misleading information",
  "Harassment",
  "Other",
];

export const REPORT_REASON_MAX = 120;
export const REPORT_DETAILS_MAX = 2000;

const bad = (message) => new AppError(message, { statusCode: 400, code: "BAD_REQUEST" });

const LEGACY_OTHER_PREFIX = /^other\s*:\s*/i;

/**
 * Normalises `{ reason, details }` from any client. Older app builds send the
 * chat form's "Other" as a single `"Other: <text>"` reason; that is split here.
 * Returns `{ reason, details }` or throws a 400 AppError with a client-safe message.
 */
export function normalizeReportInput({ reason, details } = {}) {
  let r = typeof reason === "string" ? reason.trim() : "";
  let d = typeof details === "string" ? details.trim() : "";
  if (!r) throw bad("Please select a reason.");

  if (LEGACY_OTHER_PREFIX.test(r)) {
    const rest = r.replace(LEGACY_OTHER_PREFIX, "").trim();
    r = "Other";
    d = d || rest;
  }
  if (r.length > REPORT_REASON_MAX) {
    throw bad(`Reason must be at most ${REPORT_REASON_MAX} characters.`);
  }
  if (d.length > REPORT_DETAILS_MAX) {
    throw bad(`Details must be at most ${REPORT_DETAILS_MAX} characters.`);
  }
  if (r.toLowerCase() === "other" && !d) {
    throw bad("Please describe the issue when choosing Other.");
  }
  return { reason: r, details: d || null };
}

/**
 * Files a report about the other party of [conversation] ("chat" source).
 * A customer reporting lands in expert_reports; an expert reporting lands in
 * customer_reports — the same shape either way, so the admin sees one list per
 * reported side no matter where the report came from.
 */
export async function createConversationReport(db, auth, conversation, input) {
  const { reason, details } = normalizeReportInput(input);
  if (auth.role === "customer") {
    return db.expertReport.create({
      data: {
        customerId: conversation.customerId,
        expertId: conversation.expertId,
        reason,
        details,
        source: "chat",
        conversationId: conversation.id,
      },
    });
  }
  return db.customerReport.create({
    data: {
      expertId: conversation.expertId,
      customerId: conversation.customerId,
      reason,
      details,
      source: "chat",
      conversationId: conversation.id,
    },
  });
}
