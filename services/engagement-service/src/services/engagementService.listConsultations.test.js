import { describe, expect, it, vi, beforeEach } from "vitest";
import { listConsultations } from "./engagementService.js";
import { getDb } from "@xprtlink/shared/db";

vi.mock("@xprtlink/shared/db", () => ({
  getDb: vi.fn(),
}));

const customerUserId = "fb7524f5-756b-4fbc-ba64-7999fe104eaa";
const expertUserId = "619d5c7b-0310-43bf-813a-4cf43e3826e9";
const customerProfileId = "cust-profile-1";

function consultationRow({ id, joinedParticipantIds }) {
  return {
    id,
    title: "Check this",
    note: null,
    status: "completed",
    expertId: "expert-profile-1",
    customerId: customerProfileId,
    ratePerMinuteCents: 3500,
    durationSeconds: 6,
    billingStatus: "pending",
    requestedAt: new Date("2026-09-02T13:43:50.195Z"),
    endedAt: new Date("2026-09-02T13:43:57.000Z"),
    joinedParticipantIds,
    review: null,
    customer: {
      firstName: "Emma",
      lastName: "Customer",
      user: { id: customerUserId, email: "emma@example.com" },
    },
    expert: {
      firstName: "Jhon",
      lastName: "Expert",
      currency: "USD",
      userId: expertUserId,
    },
  };
}

describe("listConsultations — customer history requires a connected call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits consultations where the customer never joined", async () => {
    const connected = consultationRow({
      id: "connected-1",
      joinedParticipantIds: [customerUserId, expertUserId],
    });
    const customerMissed = consultationRow({
      id: "836a7c2b-92c8-421b-8404-af6e2011531d",
      joinedParticipantIds: [expertUserId],
    });

    getDb.mockReturnValue({
      consultation: {
        findMany: vi.fn().mockResolvedValue([connected, customerMissed]),
        count: vi.fn().mockResolvedValue(1),
      },
    });

    const result = await listConsultations(
      { role: "customer", customerProfileId },
      { page: 1, limit: 20 }
    );

    expect(result.items.map((item) => item.id)).toEqual(["connected-1"]);
    expect(result.pagination.total).toBe(1);
    expect(result.stats).toEqual({ total: 1, thisMonth: 1 });
  });
});

describe("listConsultations — expert history filters and stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches by customer name, applies date range, and returns unfiltered completed stats", async () => {
    const row = consultationRow({
      id: "ff8872ba-244a-47be-96d9-07870e37535a",
      joinedParticipantIds: [customerUserId, expertUserId],
    });
    const findMany = vi.fn().mockResolvedValue([row]);
    const count = vi
      .fn()
      .mockResolvedValueOnce(1284)
      .mockResolvedValueOnce(42)
      .mockResolvedValueOnce(1);

    getDb.mockReturnValue({
      consultation: { findMany, count },
    });

    const result = await listConsultations(
      { role: "expert", expertProfileId: "expert-profile-1" },
      {
        q: "Emma",
        status: "completed",
        from: "2026-09-01",
        to: "2026-09-30",
        page: 1,
        limit: 20,
      }
    );

    expect(result.stats).toEqual({ total: 1284, thisMonth: 42 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].displayId).toBe("CON-37535A");
    expect(result.items[0].customerName).toBe("Emma Customer");

    const { where } = findMany.mock.calls[0][0];
    expect(where.expertId).toBe("expert-profile-1");
    expect(where.status).toBe("completed");
    expect(where.requestedAt.gte).toEqual(new Date("2026-09-01"));
    expect(where.requestedAt.lte.getUTCHours()).toBe(23);
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { customer: { firstName: { contains: "Emma", mode: "insensitive" } } },
        { customer: { lastName: { contains: "Emma", mode: "insensitive" } } },
      ])
    );
  });
});
