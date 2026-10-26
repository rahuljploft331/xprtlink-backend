import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {};
vi.mock("@xprtlink/shared/db", () => ({ getDb: () => db }));
vi.mock("@xprtlink/shared/lib/internalFetch.js", () => ({ internalPost: vi.fn(() => Promise.resolve({})) }));
vi.mock("@xprtlink/shared/lib/email.js", () => ({ sendEmail: vi.fn(), renderEmailTemplate: vi.fn(async () => "") }));
let event;
const productOf = vi.fn(async () => null);
vi.mock("./stripeService.js", () => ({ constructWebhookEvent: () => event, getPriceProductId: (...a) => productOf(...a) }));

const { handleStripeWebhook } = await import("./billingService.js");

const end = Math.floor(Date.now() / 1000) + 86400 * 20;
const updated = (priceId, extra = {}) => ({
  id: "evt_1",
  type: "customer.subscription.updated",
  data: { object: { id: "sub_1", status: "active", cancel_at_period_end: false, current_period_start: end - 86400 * 10, current_period_end: end, items: { data: [{ price: { id: priceId } }] }, ...extra } },
});

beforeEach(() => {
  productOf.mockReset(); productOf.mockResolvedValue(null);
  Object.keys(db).forEach((k) => delete db[k]);
  Object.assign(db, {
    processedWebhookEvent: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})), upsert: vi.fn(async () => ({})) },
    expertSubscription: {
      findUnique: vi.fn(async () => ({ id: "row1", planId: "plan_core", expertProfileId: "e1" })),
      findFirst: vi.fn(async () => ({ id: "row1" })),
      update: vi.fn(async () => ({})),
    },
    subscriptionPlan: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    expertProfile: { updateMany: vi.fn(async () => ({ count: 0 })) },
  });
});

const updateData = () => db.expertSubscription.update.mock.calls[0][0].data;

describe("customer.subscription.updated — plan switch from the Stripe Customer Portal", () => {
  it("follows a switch to a known Price (changes planId)", async () => {
    event = updated("price_pro");
    db.subscriptionPlan.findFirst.mockResolvedValue({ id: "plan_pro", code: "professional" });
    await handleStripeWebhook("raw", "sig");
    // (price looked up by the subscription's current Stripe price id)
    expect(db.subscriptionPlan.findFirst).toHaveBeenCalledWith({ where: { stripePriceId: "price_pro" } });
    expect(updateData().planId).toBe("plan_pro");
  });

  it("leaves the plan alone when the Price is unknown (e.g. an old replaced Price)", async () => {
    event = updated("price_old");
    db.subscriptionPlan.findFirst.mockResolvedValue(null);
    await handleStripeWebhook("raw", "sig");
    expect(updateData()).not.toHaveProperty("planId");
  });

  it("does not rewrite planId when the Price still maps to the current plan", async () => {
    event = updated("price_core");
    db.subscriptionPlan.findFirst.mockResolvedValue({ id: "plan_core", code: "core" });
    await handleStripeWebhook("raw", "sig");
    expect(updateData()).not.toHaveProperty("planId");
  });

  it("an older Price of the same Stripe Product still maps to that plan (legacy website price)", async () => {
    event = updated("price_pro_legacy");
    db.subscriptionPlan.findFirst.mockResolvedValue(null); // not any plan's current Price
    db.subscriptionPlan.findMany.mockResolvedValue([
      { id: "plan_core", code: "core", stripePriceId: "price_core" },
      { id: "plan_pro", code: "professional", stripePriceId: "price_pro" },
    ]);
    const products = { price_pro_legacy: "prod_pro", price_core: "prod_core", price_pro: "prod_pro" };
    productOf.mockImplementation(async (price) => products[price] ?? null);
    await handleStripeWebhook("raw", "sig");
    expect(updateData().planId).toBe("plan_pro");
  });

  it("a Price whose Product matches no plan changes nothing", async () => {
    event = updated("price_other");
    db.subscriptionPlan.findFirst.mockResolvedValue(null);
    db.subscriptionPlan.findMany.mockResolvedValue([{ id: "plan_core", code: "core", stripePriceId: "price_core" }]);
    productOf.mockImplementation(async (price) => ({ price_other: "prod_x", price_core: "prod_core" })[price] ?? null);
    await handleStripeWebhook("raw", "sig");
    expect(updateData()).not.toHaveProperty("planId");
  });

  it("a Stripe lookup failure never breaks the webhook (plan simply unchanged)", async () => {
    event = updated("price_unknown");
    db.subscriptionPlan.findFirst.mockResolvedValue(null);
    productOf.mockRejectedValue(new Error("stripe down"));
    await expect(handleStripeWebhook("raw", "sig")).resolves.toBeDefined();
    expect(updateData()).not.toHaveProperty("planId");
    expect(updateData().status).toBe("active");
  });

  it("still records a cancel-at-period-end made in the portal", async () => {
    db.subscriptionPlan.findFirst.mockResolvedValue({ id: "plan_core", code: "core" });
    event = updated("price_core", { cancel_at_period_end: true });
    await handleStripeWebhook("raw", "sig");
    expect(updateData().cancelAtPeriodEnd).toBe(true);
    expect(updateData().status).toBe("active");
  });
});
