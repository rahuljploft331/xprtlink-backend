import { describe, expect, it } from "vitest";
import { toConsultationSummaryDto, toConsultationBillingSummaryDto } from "./consultation.mapper.js";

const customerId = "fb7524f5-756b-4fbc-ba64-7999fe104eaa";
const expertId = "619d5c7b-0310-43bf-813a-4cf43e3826e9";

function consultationFixture(review) {
  return {
    id: "ff8872ba-244a-47be-96d9-07870e37535a",
    title: "Ufufh",
    note: "Jccjc",
    status: "completed",
    expertId,
    customerId,
    ratePerMinuteCents: 3500,
    durationSeconds: 4,
    billingStatus: "charged",
    requestedAt: new Date("2026-09-02T14:04:40.578Z"),
    endedAt: new Date("2026-09-02T14:04:49.596Z"),
    review,
  };
}

const ctx = {
  customerUser: { email: "emma@example.com" },
  customerProfile: { firstName: "Emma", lastName: "Customer" },
  expertProfile: {
    firstName: "Jhon",
    lastName: "Expert",
    currency: "USD",
    ratingAvg: 3.75,
    ratingCount: 8,
  },
  currency: "USD",
};

describe("toConsultationSummaryDto — session-relative review", () => {
  it("sets hasReview true and expertRating to the customer's submitted rating", () => {
    const dto = toConsultationSummaryDto(
      consultationFixture({
        id: "rev-1",
        customerId,
        rating: 5,
      }),
      ctx
    );

    expect(dto.hasReview).toBe(true);
    expect(dto.expertRating).toBe(5);
    expect(dto.expertRatingAvg).toBe(3.75);
    expect(dto.expertReviewCount).toBe(8);
    expect(dto.displayId).toBe("CON-37535A");
    expect(dto.billableMinutes).toBe(1);
    expect(dto.total).toBe(1.17);
  });

  it("sets hasReview false and expertRating null when this customer has not reviewed", () => {
    const dto = toConsultationSummaryDto(consultationFixture(null), ctx);

    expect(dto.hasReview).toBe(false);
    expect(dto.expertRating).toBeNull();
  });
});

describe("toConsultationBillingSummaryDto — per 30 minutes, billed in minutes", () => {
  it("bills 4s at $35 / 30 min as 1 minute, not $35", () => {
    const dto = toConsultationBillingSummaryDto(consultationFixture(null));

    expect(dto.durationSeconds).toBe(4);
    expect(dto.billableMinutes).toBe(1);
    expect(dto.ratePer30Minutes).toBe(35);
    expect(dto.ratePerMinute).toBe(1.17);
    expect(dto.subtotal).toBe(1.17);
    expect(dto.total).toBe(1.17);
  });

  it("bills 54s at $60 / 30 min as $2", () => {
    const dto = toConsultationBillingSummaryDto({
      ...consultationFixture(null),
      ratePerMinuteCents: 6000,
      durationSeconds: 54,
    });

    expect(dto.billableMinutes).toBe(1);
    expect(dto.ratePer30Minutes).toBe(60);
    expect(dto.ratePerMinute).toBe(2);
    expect(dto.subtotal).toBe(2);
    expect(dto.total).toBe(2);
    expect(dto.commission).toBe(0.3);
  });

  it("uses the captured charge breakdown when both shares are present", () => {
    const dto = toConsultationBillingSummaryDto(consultationFixture(null), {
      commissionCents: 18,
      expertShareCents: 99,
    });

    expect(dto.subtotal).toBe(1.17);
    expect(dto.total).toBe(1.17);
    expect(dto.commission).toBe(0.18);
    expect(dto.expertShare).toBe(0.99);
  });
});
