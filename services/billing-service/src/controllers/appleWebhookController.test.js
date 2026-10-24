import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan-carrying behaviour of the Apple notification handler.
 *
 * The case that matters: a downgrade is deferred by Apple, so the row must keep
 * its plan at DID_CHANGE_RENEWAL_PREF and only follow the store at DID_RENEW,
 * when Apple actually bills the cheaper product.
 */

const decoded = { notification: null, transaction: null, renewal: null };

vi.mock("@apple/app-store-server-library", () => ({
  SignedDataVerifier: class {
    verifyAndDecodeNotification() { return decoded.notification; }
    verifyAndDecodeTransaction() { return decoded.transaction; }
    verifyAndDecodeRenewalInfo() { return decoded.renewal; }
  },
  Environment: { SANDBOX: "Sandbox", PRODUCTION: "Production" },
}));

const db = {};
vi.mock("@xprtlink/shared/db/index.js", () => ({ getDb: () => db }));
vi.mock("../services/subscriptionStore.js", () => ({ notifyAutoRenewDisabled: vi.fn() }));
vi.mock("../services/subscriptionLog.js", () => ({ logSubscriptionEvent: vi.fn() }));

const { handleNotification } = await import("./appleWebhookController.js");

const PLANS = [
  { id: "p-core", code: "core", isActive: true },
  { id: "p-pro", code: "professional", isActive: true },
  { id: "p-elite", code: "elite", isActive: true },
];
const TX = "2000001254959055";
const DAY = 86400000;

let row;
beforeEach(() => {
  process.env.APPLE_BUNDLE_ID = "com.app.xprtlink";
  row = {
    id: "s1",
    expertProfileId: "e1",
    planId: "p-elite",
    plan: { code: "elite" },
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 10 * DAY),
    cancelAtPeriodEnd: false,
    expert: { userId: "u1" },
  };
  db.expertSubscription = {
    findFirst: vi.fn(async () => row),
    update: vi.fn(async ({ data }) => Object.assign(row, data)),
  };
  db.subscriptionPlan = {
    findFirst: vi.fn(async ({ where }) => PLANS.find((p) => p.code === (where.code ?? where.OR?.find((c) => c.code)?.code)) ?? null),
  };
  db.expertProfile = { update: vi.fn(), updateMany: vi.fn() };
  decoded.transaction = { originalTransactionId: TX, productId: "elite", expiresDate: Date.now() + 30 * DAY };
  decoded.renewal = null;
});

const fire = async (notificationType, subtype) => {
  decoded.notification = { notificationType, subtype, data: { signedTransactionInfo: "t", signedRenewalInfo: "r", environment: "Sandbox" } };
  const res = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
  await handleNotification({ body: { signedPayload: "p" } }, res, vi.fn());
  return res;
};

describe("DID_RENEW carries the plan", () => {
  it("applies a downgrade that took effect at renewal", async () => {
    // Apple renews on the cheaper product; the row must follow or the expert
    // keeps elite entitlement while paying for core.
    decoded.transaction.productId = "core";
    const res = await fire("DID_RENEW");

    expect(row.planId).toBe("p-core");
    expect(row.status).toBe("active");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("leaves the plan alone when the product is unchanged", async () => {
    await fire("DID_RENEW");
    expect(row.planId).toBe("p-elite");
  });

  it("keeps the current plan when the product is unknown to us", async () => {
    decoded.transaction.productId = "some_retired_sku";
    await fire("DID_RENEW");
    expect(row.planId).toBe("p-elite");
  });
});

describe("DID_CHANGE_RENEWAL_PREF", () => {
  it("DOWNGRADE is deferred — plan and period are untouched", async () => {
    const periodEnd = row.currentPeriodEnd;
    decoded.renewal = { autoRenewProductId: "core" };
    const res = await fire("DID_CHANGE_RENEWAL_PREF", "DOWNGRADE");

    expect(row.planId).toBe("p-elite");
    expect(row.currentPeriodEnd).toBe(periodEnd);
    expect(row.status).toBe("active");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("UPGRADE applies immediately", async () => {
    row.planId = "p-core";
    row.plan = { code: "core" };
    decoded.transaction.productId = "elite";
    decoded.renewal = { autoRenewProductId: "elite" };
    await fire("DID_CHANGE_RENEWAL_PREF", "UPGRADE");

    expect(row.planId).toBe("p-elite");
    expect(row.cancelAtPeriodEnd).toBe(false);
  });

  it("a reverted pending change leaves the row as-is", async () => {
    decoded.renewal = { autoRenewProductId: "elite" };
    const res = await fire("DID_CHANGE_RENEWAL_PREF", undefined);

    expect(row.planId).toBe("p-elite");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("still answers 200 when renewal info cannot be decoded", async () => {
    decoded.renewal = null;
    const res = await fire("DID_CHANGE_RENEWAL_PREF", "DOWNGRADE");
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
