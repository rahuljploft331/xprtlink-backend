import { describe, expect, it } from "vitest";
import { computeConsultationChargeCents } from "./billingService.js";

/**
 * Client decision, 31 Aug 2026 call §7.2:
 *   "A partial minute is rounded up to the next full minute."
 *   Worked example from the document: 10 minutes 20 seconds bills as 11 minutes.
 *
 * The rule rounds MINUTES, not cents. These tests exist to stop a regression to the
 * old prorated form, Math.ceil((seconds / 60) * rate), which under-charged every
 * partial minute.
 */
describe("computeConsultationChargeCents — partial minutes round up", () => {
  const rate = (ratePerMinuteCents) => ({ ratePerMinuteCents });

  it("bills the document's worked example (10m20s @ $1/min) as 11 minutes", () => {
    expect(computeConsultationChargeCents({ ...rate(100), durationSeconds: 620 })).toBe(1100);
  });

  it("does NOT prorate by the second (the old bug charged 1034¢ here)", () => {
    expect(computeConsultationChargeCents({ ...rate(100), durationSeconds: 620 })).not.toBe(1034);
  });

  it("leaves exact minutes untouched", () => {
    expect(computeConsultationChargeCents({ ...rate(100), durationSeconds: 600 })).toBe(1000);
    expect(computeConsultationChargeCents({ ...rate(250), durationSeconds: 180 })).toBe(750);
  });

  it("rounds any partial minute up to a whole one", () => {
    expect(computeConsultationChargeCents({ ...rate(100), durationSeconds: 1 })).toBe(100);
    expect(computeConsultationChargeCents({ ...rate(100), durationSeconds: 59 })).toBe(100);
    expect(computeConsultationChargeCents({ ...rate(100), durationSeconds: 61 })).toBe(200);
  });

  it("charges nothing for a zero or missing duration", () => {
    expect(computeConsultationChargeCents({ ...rate(100), durationSeconds: 0 })).toBe(0);
    expect(computeConsultationChargeCents(rate(100))).toBe(0);
  });

  it("always yields whole cents, so commission never derives from a fraction", () => {
    for (const seconds of [1, 59, 61, 620, 3599]) {
      const cents = computeConsultationChargeCents({ ...rate(333), durationSeconds: seconds });
      expect(Number.isInteger(cents)).toBe(true);
    }
  });

  it("prefers an explicit duration override over the stored row", () => {
    const consultation = { ...rate(100), durationSeconds: 600 };
    expect(computeConsultationChargeCents(consultation, 620)).toBe(1100);
    // undefined override must fall back to the row, not to zero
    expect(computeConsultationChargeCents(consultation, undefined)).toBe(1000);
  });
});
