import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {};
vi.mock("@xprtlink/shared/db", () => ({ getDb: () => db }));
vi.mock("@xprtlink/shared/lib/internalFetch.js", () => ({ internalPost: vi.fn(() => Promise.resolve({})) }));
vi.mock("@xprtlink/shared/lib/email.js", () => ({ sendEmail: vi.fn(), renderEmailTemplate: vi.fn(async () => "") }));
const scheduled = vi.fn();
vi.mock("./stripeService.js", () => ({ getScheduledPriceChange: (...a) => scheduled(...a), getPriceProductId: vi.fn(async () => null) }));
vi.mock("./subscriptionStore.js", async (orig) => ({ ...(await orig()), reconcileSubscription: async (_db, sub) => sub }));

const { getMySubscription } = await import("./billingService.js");

const pro = { id: "p-pro", code: "professional", name: "Professional", priceCents: 2699, currency: "USD" };
const core = { id: "p-core", code: "core", name: "Core", priceCents: 899, currency: "USD" };
const sub = (o = {}) => ({
  id: "s1", planId: pro.id, plan: pro, store: "stripe", externalSubscriptionId: "sub_1", status: "active",
  cancelAtPeriodEnd: false, currentPeriodStart: new Date(), currentPeriodEnd: new Date("2030-01-01"), ...o,
});
const auth = { expertProfileId: "e1" };
const when = new Date("2030-01-01T00:00:00Z");

beforeEach(() => {
  scheduled.mockReset();
  Object.keys(db).forEach((k) => delete db[k]);
  Object.assign(db, {
    expertSubscription: { findFirst: vi.fn(async () => sub()), update: vi.fn() },
    subscriptionPlan: { findFirst: vi.fn(async ({ where }) => (where.stripePriceId === "price_core" ? core : null)), findMany: vi.fn(async () => []) },
  });
});

describe("getMySubscription — pending (scheduled) plan change", () => {
  it("reports a downgrade waiting for the end of the paid period", async () => {
    scheduled.mockResolvedValue({ priceId: "price_core", startsAt: when });
    const r = await getMySubscription(auth, { includePending: true });
    expect(r.plan.code).toBe("professional"); // still on the higher plan until then
    expect(r.pendingPlanChange).toEqual({ planCode: "core", planName: "Core", effectiveAt: when.toISOString() });
  });

  it("pendingPlanChange is null when nothing is scheduled", async () => {
    scheduled.mockResolvedValue(null);
    expect((await getMySubscription(auth, { includePending: true })).pendingPlanChange).toBeNull();
  });

  it("is opt-in: without includePending there is no Stripe call and no field (the app's calls are unchanged)", async () => {
    const r = await getMySubscription(auth);
    expect(scheduled).not.toHaveBeenCalled();
    expect(r).not.toHaveProperty("pendingPlanChange");
  });

  it("a Stripe failure never breaks the subscription response", async () => {
    scheduled.mockRejectedValue(new Error("stripe down"));
    const r = await getMySubscription(auth, { includePending: true });
    expect(r.pendingPlanChange).toBeNull();
    expect(r.plan.code).toBe("professional");
  });

  it("App Store / Google Play subscriptions never ask Stripe", async () => {
    db.expertSubscription.findFirst.mockResolvedValue(sub({ store: "apple", externalSubscriptionId: "otx" }));
    const r = await getMySubscription(auth, { includePending: true });
    expect(scheduled).not.toHaveBeenCalled();
    expect(r.pendingPlanChange).toBeNull();
  });
});
