/** Listed expert rate is the price of a 30-minute block. */
export const CONSULTATION_RATE_MINUTES = 30;

export const CONSULTATION_COMMISSION_RATE = 0.15;

/**
 * Convert stored call length to billable minutes.
 * Partial minutes round UP — 54s → 1, 10m20s → 11. Never prorate by the second.
 */
export function consultationBillableMinutes(durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  return Math.ceil(durationSeconds / 60);
}

/**
 * Per-minute equivalent of a 30-minute listed rate, in cents.
 * $60 / 30 min → 200¢/min.
 */
export function perMinuteCentsFromListedRate(ratePer30MinutesCents) {
  return Math.round((ratePer30MinutesCents ?? 0) / CONSULTATION_RATE_MINUTES);
}

/**
 * Customer charge for a consultation, in cents.
 *
 * Listed rate (`ratePerMinuteCents` column) is **per 30 minutes**.
 * Duration is billed in whole minutes (seconds only feed that rounding):
 *   billableMinutes = ceil(durationSeconds / 60)
 *   chargeCents     = round(billableMinutes × listedRate / 30)
 *
 * Same number for customer charge, expert earnings, and platform commission.
 *
 * @param {{ ratePerMinuteCents: number, durationSeconds?: number|null }} consultation
 * @param {number} [durationSecondsOverride]
 */
export function computeConsultationChargeCents(consultation, durationSecondsOverride) {
  const durationSeconds = durationSecondsOverride ?? consultation.durationSeconds ?? 0;
  const listedRateCents = consultation.ratePerMinuteCents ?? 0;
  const minutes = consultationBillableMinutes(durationSeconds);
  return Math.round((minutes * listedRateCents) / CONSULTATION_RATE_MINUTES);
}

export function computeConsultationCommissionCents(
  chargeCents,
  rate = CONSULTATION_COMMISSION_RATE
) {
  return Math.round(chargeCents * rate);
}

/** Stripe pre-auth: one 30-minute block, or $30, whichever is larger. */
export function consultationHoldMinimumCents(ratePer30MinutesCents) {
  return Math.max(ratePer30MinutesCents ?? 0, 3000);
}
