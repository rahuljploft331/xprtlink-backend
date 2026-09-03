import { describe, expect, it } from "vitest";
import { computeConsultationChargeCents } from "./billingService.js";

/**
 * Listed rate is per 30 minutes. Duration is converted to whole minutes first
 * (partial minutes round up). Charge = round(minutes × listedRate / 30).
 */
describe("computeConsultationChargeCents — per 30 minutes, billed in minutes", () => {
  const rate = (ratePer30MinutesCents) => ({ ratePerMinuteCents: ratePer30MinutesCents });

  it("bills 54s at $60 / 30 min as 1 minute ($2), not $60", () => {
    expect(computeConsultationChargeCents({ ...rate(6000), durationSeconds: 54 })).toBe(200);
  });

  it("does NOT prorate by the second", () => {
    // 10m20s at $30 / 30 min ($1/min equivalent) → 11 minutes → $11
    expect(computeConsultationChargeCents({ ...rate(3000), durationSeconds: 620 })).toBe(1100);
    expect(computeConsultationChargeCents({ ...rate(3000), durationSeconds: 620 })).not.toBe(
      Math.ceil((620 / 60) * 3000)
    );
  });

  it("charges one 30-minute block at exactly 30 minutes", () => {
    expect(computeConsultationChargeCents({ ...rate(6000), durationSeconds: 1800 })).toBe(6000);
  });

  it("prorates 45 minutes of a $60 / 30 min rate as $90", () => {
    expect(computeConsultationChargeCents({ ...rate(6000), durationSeconds: 2700 })).toBe(9000);
  });

  it("rounds any partial minute up to a whole one before applying the rate", () => {
    expect(computeConsultationChargeCents({ ...rate(6000), durationSeconds: 1 })).toBe(200);
    expect(computeConsultationChargeCents({ ...rate(6000), durationSeconds: 59 })).toBe(200);
    expect(computeConsultationChargeCents({ ...rate(6000), durationSeconds: 61 })).toBe(400);
  });

  it("charges nothing for a zero or missing duration", () => {
    expect(computeConsultationChargeCents({ ...rate(6000), durationSeconds: 0 })).toBe(0);
    expect(computeConsultationChargeCents(rate(6000))).toBe(0);
  });

  it("always yields whole cents", () => {
    for (const seconds of [1, 59, 61, 620, 3599]) {
      const cents = computeConsultationChargeCents({ ...rate(333), durationSeconds: seconds });
      expect(Number.isInteger(cents)).toBe(true);
    }
  });

  it("prefers an explicit duration override over the stored row", () => {
    const consultation = { ...rate(3000), durationSeconds: 600 };
    expect(computeConsultationChargeCents(consultation, 620)).toBe(1100);
    expect(computeConsultationChargeCents(consultation, undefined)).toBe(1000);
  });
});
