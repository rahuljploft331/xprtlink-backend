import { describe, expect, it, vi, beforeEach } from "vitest";
import { getCallStatus } from "./engagementService.js";
import { getDb } from "@xprtlink/shared/db";

// Mock the database
vi.mock("@xprtlink/shared/db", () => ({
  getDb: vi.fn(),
}));

describe("getCallStatus — Correct ZEGOCLOUD Join Status", () => {
  const consultationId = "836a7c2b-92c8-421b-8404-af6e2011531d";
  const customerId = "cust-1234-abcd";
  const expertId = "expr-5678-efgh";

  const setupMockDb = (joinedParticipantIds, startedAt = null) => {
    getDb.mockReturnValue({
      consultation: {
        findUnique: vi.fn().mockResolvedValue({
          id: consultationId,
          joinedParticipantIds,
          startedAt,
          status: "completed",
          durationSeconds: 6,
          customer: { user: { id: customerId } },
          expert: { userId: expertId },
        }),
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Case 1 — Customer joins, expert does not join", async () => {
    setupMockDb([customerId]);

    const result = await getCallStatus(consultationId);

    expect(result).toMatchObject({
      customerJoined: true,
      expertJoined: false,
      wasSuccessfullyConnected: false,
    });
  });

  it("Case 2 — Expert joins, customer does not join", async () => {
    setupMockDb([expertId]);

    const result = await getCallStatus(consultationId);

    expect(result).toMatchObject({
      customerJoined: false,
      expertJoined: true,
      wasSuccessfullyConnected: false,
    });
  });

  it("Case 3 — Both customer and expert join", async () => {
    setupMockDb([customerId, expertId]);

    const result = await getCallStatus(consultationId);

    expect(result).toMatchObject({
      customerJoined: true,
      expertJoined: true,
      wasSuccessfullyConnected: true,
    });
  });

  it("Case 4 — Nobody joins", async () => {
    setupMockDb([]);

    const result = await getCallStatus(consultationId);

    expect(result).toMatchObject({
      customerJoined: false,
      expertJoined: false,
      wasSuccessfullyConnected: false,
    });
  });

  it("Case 5 — Both join and then one/both leave", async () => {
    // If they joined at any point, their IDs are in joinedParticipantIds.
    // The fact they left doesn't remove their IDs from joinedParticipantIds (we use push in zegoCallbackService).
    setupMockDb([customerId, expertId]);

    const result = await getCallStatus(consultationId);

    expect(result).toMatchObject({
      customerJoined: true,
      expertJoined: true,
      wasSuccessfullyConnected: true,
      status: "completed", // verifies they can leave/end call, history remains
    });
  });

  it("Handles UUIDs with missing hyphens correctly", async () => {
    // Simulated Zego payload with missing hyphens
    const noHyphenCustomer = customerId.replace(/-/g, "");
    const noHyphenExpert = expertId.replace(/-/g, "");
    
    setupMockDb([noHyphenCustomer, noHyphenExpert]);

    const result = await getCallStatus(consultationId);

    expect(result).toMatchObject({
      customerJoined: true,
      expertJoined: true,
      wasSuccessfullyConnected: true,
    });
  });

  it("Does not base wasSuccessfullyConnected only on startedAt", async () => {
    // Even if startedAt is set (perhaps a manual intervention or legacy data), 
    // it shouldn't connect them if join IDs aren't present.
    setupMockDb([], new Date());

    const result = await getCallStatus(consultationId);

    expect(result).toMatchObject({
      customerJoined: false,
      expertJoined: false,
      wasSuccessfullyConnected: false,
    });
  });
});
