import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {};
vi.mock("@xprtlink/shared/db", () => ({ getDb: () => db }));
vi.mock("@xprtlink/shared/lib/internalFetch.js", () => ({ internalPost: vi.fn(() => Promise.resolve({})) }));
vi.mock("@xprtlink/shared/lib/email.js", () => ({ sendEmail: vi.fn(), renderEmailTemplate: vi.fn(async () => "") }));
const portal = vi.fn(async () => ({ url: "https://billing.stripe.com/p/session/test" }));
vi.mock("./stripeService.js", () => ({
  createBillingPortalSession: (...a) => portal(...a),
  constructWebhookEvent: vi.fn(),
}));

const { createStripePortalSession } = await import("./billingService.js");
const auth = { userId: "u1", expertProfileId: "e1" };

beforeEach(() => {
  portal.mockClear();
  process.env.WEB_CHECKOUT_ALLOWED_ORIGINS = "https://xprtlink.com";
  delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  Object.keys(db).forEach((k) => delete db[k]);
  Object.assign(db, { expertSubscription: { findFirst: vi.fn() } });
});

describe("createStripePortalSession", () => {
  it("opens the portal for the expert's active Stripe subscription", async () => {
    db.expertSubscription.findFirst.mockResolvedValue({ externalSubscriptionId: "sub_1" });
    const r = await createStripePortalSession(auth, { returnUrl: "https://xprtlink.com/expert-signup.html" });
    expect(r).toEqual({ portalUrl: "https://billing.stripe.com/p/session/test" });
    expect(portal).toHaveBeenCalledWith({
      stripeSubscriptionId: "sub_1",
      returnUrl: "https://xprtlink.com/expert-signup.html",
      configurationId: undefined,
    });
    // only the expert's own Stripe subscription is considered
    expect(db.expertSubscription.findFirst.mock.calls[0][0].where).toMatchObject({ expertProfileId: "e1", store: "stripe" });
  });

  it("passes a configured portal configuration through", async () => {
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_123";
    db.expertSubscription.findFirst.mockResolvedValue({ externalSubscriptionId: "sub_1" });
    await createStripePortalSession(auth, { returnUrl: "https://xprtlink.com/x" });
    expect(portal.mock.calls[0][0].configurationId).toBe("bpc_123");
  });

  it("rejects return links outside our own origins before touching Stripe", async () => {
    db.expertSubscription.findFirst.mockResolvedValue({ externalSubscriptionId: "sub_1" });
    await expect(createStripePortalSession(auth, { returnUrl: "https://evil.example/steal" })).rejects.toMatchObject({ code: "CHECKOUT_URL_NOT_ALLOWED" });
    expect(portal).not.toHaveBeenCalled();
  });

  it("404s when the expert has no website (Stripe) subscription — e.g. Apple/Google only", async () => {
    db.expertSubscription.findFirst.mockResolvedValue(null);
    await expect(createStripePortalSession(auth, { returnUrl: "https://xprtlink.com/x" })).rejects.toBeDefined();
    expect(portal).not.toHaveBeenCalled();
  });
});
