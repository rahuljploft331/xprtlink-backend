import { describe, expect, it } from "vitest";
import { toConsultationSummaryDto } from "./consultation.mapper.js";

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
  });

  it("sets hasReview false and expertRating null when this customer has not reviewed", () => {
    const dto = toConsultationSummaryDto(consultationFixture(null), ctx);

    expect(dto.hasReview).toBe(false);
    expect(dto.expertRating).toBeNull();
  });
});
