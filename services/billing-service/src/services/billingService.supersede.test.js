import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of EXISTING behaviour: when an in-app purchase supersedes another store's subscription the
// old one is cancelled at its own store (Stripe: immediately), so the expert is never billed twice.
const db = {};
vi.mock("@xprtlink/shared/db", () => ({ getDb: () => db }));
vi.mock("@xprtlink/shared/lib/internalFetch.js", () => ({ internalPost: vi.fn(() => Promise.resolve({})) }));
vi.mock("@xprtlink/shared/lib/email.js", () => ({ sendEmail: vi.fn(), renderEmailTemplate: vi.fn(async () => "") }));
const stripeCancel = vi.fn();
vi.mock("./stripeService.js", () => ({ cancelStripeSubscriptionImmediate: (...a) => stripeCancel(...a) }));

const { cancelSupersededSubscriptions } = await import("./billingService.js");

beforeEach(() => { stripeCancel.mockReset(); Object.keys(db).forEach((k) => delete db[k]); });

describe("cancelSupersededSubscriptions (unchanged)", () => {
  it("cancels a superseded Stripe subscription immediately on Stripe", async () => {
    const r = await cancelSupersededSubscriptions([{ id: "s1", store: "stripe", externalSubscriptionId: "sub_1", expertProfileId: "e1" }]);
    expect(stripeCancel).toHaveBeenCalledWith("sub_1");
    expect(r).toEqual([{ store: "stripe", canceledAtStore: true, manualCancelRequired: false }]);
  });

  it("flags manual cancellation when the Stripe cancel fails, without throwing", async () => {
    stripeCancel.mockRejectedValue(new Error("stripe down"));
    const r = await cancelSupersededSubscriptions([{ id: "s1", store: "stripe", externalSubscriptionId: "sub_1", expertProfileId: "e1" }]);
    expect(r).toEqual([{ store: "stripe", canceledAtStore: false, manualCancelRequired: true }]);
  });

  it("Apple has no server-side cancel API: reports manual cancellation", async () => {
    const r = await cancelSupersededSubscriptions([{ id: "s2", store: "apple", externalSubscriptionId: "otx", expertProfileId: "e1" }]);
    expect(r).toEqual([{ store: "apple", canceledAtStore: false, manualCancelRequired: true }]);
  });
});
