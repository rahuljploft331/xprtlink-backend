import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {};
vi.mock("@xprtlink/shared/db", () => ({ getDb: () => db }));
vi.mock("@xprtlink/shared/lib/internalFetch.js", () => ({ internalPost: vi.fn(() => Promise.resolve({})) }));
vi.mock("@xprtlink/shared/lib/email.js", () => ({
  sendEmail: vi.fn(),
  renderEmailTemplate: vi.fn(async () => ""),
}));
const stripeCancel = vi.fn();
vi.mock("./stripeService.js", () => ({ setStripeCancelAtPeriodEnd: (...a) => stripeCancel(...a) }));
// No store credentials → reconcile is a no-op, so only stored (webhook) state is reported.
vi.mock("./subscriptionStore.js", async (orig) => ({
  ...(await orig()),
  reconcileSubscription: async (_db, sub) => sub,
}));

const { cancelSubscription } = await import("./billingService.js");

const plan = { id: "p1", code: "professional", name: "Professional", priceCents: 1000, currency: "USD" };
const sub = (o = {}) => ({
  id: "s1", expertProfileId: "e1", planId: "p1", plan, store: "apple", externalSubscriptionId: "otx",
  status: "active", cancelAtPeriodEnd: false, currentPeriodStart: new Date(), currentPeriodEnd: new Date("2030-01-01"), ...o,
});
const auth = { userId: "u1", expertProfileId: "e1" };

beforeEach(() => {
  stripeCancel.mockReset();
  Object.keys(db).forEach((k) => delete db[k]);
  Object.assign(db, {
    expertSubscription: { findFirst: vi.fn(), update: vi.fn(({ data }) => ({ ...sub(), ...data })) },
    user: { findUnique: vi.fn(() => ({ email: null })) },
  });
});

describe("cancelSubscription — provider-based", () => {
  it("apple: returns Apple management URL, never marks cancelled", async () => {
    db.expertSubscription.findFirst.mockResolvedValue(sub({ store: "apple" }));
    const r = await cancelSubscription(auth);
    expect(r.platform).toBe("ios");
    expect(r.subscriptionManagementUrl).toBe("https://apps.apple.com/account/subscriptions");
    expect(r.manualCancelRequired).toBe(true);
    expect(r.cancellationConfirmed).toBe(false);
    expect(r.autoRenewEnabled).toBe(true);
    expect(db.expertSubscription.update).not.toHaveBeenCalled();
  });

  it("google: returns Play URL regardless of caller device", async () => {
    db.expertSubscription.findFirst.mockResolvedValue(sub({ store: "google" }));
    const r = await cancelSubscription(auth);
    expect(r.platform).toBe("android");
    expect(r.subscriptionManagementUrl).toContain("play.google.com/store/account/subscriptions");
    expect(db.expertSubscription.update).not.toHaveBeenCalled();
  });

  it("apple: once a verified webhook set autoRenew off, reports confirmed (idempotent)", async () => {
    db.expertSubscription.findFirst.mockResolvedValue(sub({ cancelAtPeriodEnd: true }));
    const r = await cancelSubscription(auth);
    expect(r.cancellationConfirmed).toBe(true);
    expect(r.autoRenewEnabled).toBe(false);
    expect(r.manualCancelRequired).toBe(false);
  });

  it("stripe: still cancels at period end via Stripe", async () => {
    db.expertSubscription.findFirst.mockResolvedValue(sub({ store: "stripe", externalSubscriptionId: "sub_1" }));
    const r = await cancelSubscription(auth);
    expect(stripeCancel).toHaveBeenCalledWith("sub_1");
    expect(r.cancelAtPeriodEnd).toBe(true);
    expect(r.cancellationConfirmed).toBe(true);
    expect(r.subscriptionManagementUrl).toBeNull();
  });
});
