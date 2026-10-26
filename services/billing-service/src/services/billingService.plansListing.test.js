import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {};
vi.mock("@xprtlink/shared/db", () => ({ getDb: () => db }));
vi.mock("@xprtlink/shared/lib/internalFetch.js", () => ({ internalPost: vi.fn(() => Promise.resolve({})) }));
vi.mock("@xprtlink/shared/lib/email.js", () => ({ sendEmail: vi.fn(), renderEmailTemplate: vi.fn(async () => "") }));

const { listSubscriptionPlans } = await import("./billingService.js");

const mk = (id, code, cents) => ({ id, code, name: code, tagline: "", priceMonthlyCents: cents, currency: "USD", keyFeatures: [], isMostPopular: false, isActive: true });
const PLANS = [mk("p1", "core", 999), mk("p2", "professional", 2999), mk("p3", "elite", 4999)];
const auth = { expertProfileId: "e1" };
const sub = (store, planCode) => ({ planId: PLANS.find((p) => p.code === planCode).id, store, plan: PLANS.find((p) => p.code === planCode) });

beforeEach(() => {
  Object.keys(db).forEach((k) => delete db[k]);
  Object.assign(db, {
    subscriptionPlan: { findMany: vi.fn(async () => PLANS) },
    expertSubscription: { findFirst: vi.fn(async () => null) },
  });
});
const byCode = (list, code) => list.find((p) => p.code === code);

describe("listSubscriptionPlans — where the subscription is managed", () => {
  it("Stripe subscriber: no purchase/upgrade/restore anywhere, only 'manage on the website'", async () => {
    db.expertSubscription.findFirst.mockResolvedValue(sub("stripe", "core"));
    const list = await listSubscriptionPlans(auth);
    for (const p of list) {
      expect(p).toMatchObject({ managedOnWeb: true, restoreEligible: false, planPurchaseEligible: false, purchaseEligible: false, activeSubscriptionStore: "stripe" });
      expect(p.managementUrl).toContain("xprtlink.com");
    }
    expect(byCode(list, "core").planChangeAction).toBe("current");
    expect(byCode(list, "elite").planChangeAction).toBe("manage_on_web");
  });

  it("in-app (Google) subscriber: upgrade still offered, downgrade still blocked, restore allowed", async () => {
    db.expertSubscription.findFirst.mockResolvedValue(sub("google", "professional"));
    const list = await listSubscriptionPlans(auth);
    expect(byCode(list, "elite")).toMatchObject({ planChangeAction: "upgrade", planPurchaseEligible: true, managedOnWeb: false, restoreEligible: true, managementUrl: null });
    expect(byCode(list, "core")).toMatchObject({ planChangeAction: "downgrade_blocked", planPurchaseEligible: false });
  });

  it("no subscription: everything is purchasable and restore is allowed", async () => {
    const list = await listSubscriptionPlans(auth);
    for (const p of list) expect(p).toMatchObject({ planChangeAction: "purchase", planPurchaseEligible: true, purchaseEligible: true, managedOnWeb: false, restoreEligible: true });
  });
});
