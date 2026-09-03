/**
 * Billable charge for a consultation, in cents.
 *
 * Client decision (31 Aug 2026 call, §7.2): a partial minute is rounded UP to the
 * next full minute — 10m20s bills as 11 minutes. Round the MINUTES, not the cents.
 * The previous form, `Math.ceil((seconds / 60) * rate)`, prorated by the second and
 * under-charged every partial minute (10m20s at $1/min charged $10.34, not $11.00).
 *
 * Single source of truth: the customer charge, expert earnings, platform commission
 * and consultation billing-summary must all derive from this one number.
 *
 * @param {{ ratePerMinuteCents: number, durationSeconds?: number|null }} consultation
 * @param {number} [durationSecondsOverride] actual duration when the caller knows better than the row
 */
export function computeConsultationChargeCents(consultation, durationSecondsOverride) {
  const durationSeconds = durationSecondsOverride ?? consultation.durationSeconds ?? 0;
  const ratePerMinuteCents = consultation.ratePerMinuteCents ?? 0;
  const billableMinutes = Math.ceil(durationSeconds / 60);
  return billableMinutes * ratePerMinuteCents;
}

export const CONSULTATION_COMMISSION_RATE = 0.15;

export function computeConsultationCommissionCents(
  chargeCents,
  rate = CONSULTATION_COMMISSION_RATE
) {
  return Math.round(chargeCents * rate);
}
