import { beforeEach, describe, expect, it, vi } from "vitest";

const configs = { retrieve: vi.fn(), list: vi.fn(), create: vi.fn() };
vi.mock("stripe", () => ({ default: class { constructor() { this.billingPortal = { configurations: configs }; } } }));
vi.mock("@xprtlink/shared/config/secrets.js", () => ({ getSecretSync: () => "sk_test_dummy" }));

const { ensurePortalConfiguration, PLAN_CHANGE_RULES } = await import("./stripeService.js");

const listOf = (data) => Object.assign(Promise.resolve({ data }), { autoPagingToArray: async () => data });
const base = (over = {}) => ({
  id: "bpc_base", is_default: true, active: true, metadata: {},
  business_profile: { headline: "XprtLink billing", privacy_policy_url: null, terms_of_service_url: "https://xprtlink.com/terms" },
  features: {
    customer_update: { enabled: true, allowed_updates: ["name", "email"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none", cancellation_reason: { enabled: true, options: ["too_expensive", "other"] } },
    subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "create_prorations", schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }] }, trial_update_behavior: "continue_trial" },
    ...over,
  },
});
const PRODUCTS = [{ product: "prod_core", prices: ["price_core"] }, { product: "prod_pro", prices: ["price_pro"] }];

beforeEach(() => {
  Object.values(configs).forEach((f) => f.mockReset());
  configs.retrieve.mockResolvedValue(base());
  configs.list.mockImplementation((args) => (args?.is_default ? listOf([base()]) : listOf([])));
  configs.create.mockResolvedValue({ id: "bpc_new" });
});

describe("ensurePortalConfiguration", () => {
  it("creates a copy of the base settings that offers exactly the given products", async () => {
    await expect(ensurePortalConfiguration({ products: PRODUCTS })).resolves.toBe("bpc_new");
    const arg = configs.create.mock.calls[0][0];
    expect(arg.features.subscription_update).toMatchObject({ enabled: true, products: PRODUCTS, default_allowed_updates: ["price"] });
    // everything else the admin set in the Dashboard is carried over
    expect(arg.features.subscription_cancel).toMatchObject({ enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "other"] } });
    expect(arg.features.customer_update).toEqual({ enabled: true, allowed_updates: ["name", "email"] });
    expect(arg.business_profile).toEqual({ headline: "XprtLink billing", terms_of_service_url: "https://xprtlink.com/terms" });
    expect(arg.metadata).toMatchObject({ xprt_portal_base: "bpc_base", xprt_portal_key: expect.any(String) });
  });

  it("plan-change billing follows the business rules whatever the Dashboard says: upgrade now at full price, downgrade at period end", async () => {
    // the base is deliberately configured the 'wrong' way
    configs.list.mockImplementation((args) => (args?.is_default ? listOf([base({ subscription_update: { enabled: true, proration_behavior: "create_prorations", billing_cycle_anchor: "unchanged", trial_update_behavior: "continue_trial", schedule_at_period_end: { conditions: [] } } })]) : listOf([])));
    await ensurePortalConfiguration({ products: PRODUCTS });
    const u = configs.create.mock.calls[0][0].features.subscription_update;
    expect(u).toMatchObject({
      proration_behavior: "none",          // no credit for the unused old plan
      billing_cycle_anchor: "now",         // upgrade: new cycle, full new price charged immediately
      trial_update_behavior: "end_trial",  // upgrading in a trial charges now
      schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }] }, // downgrade waits for the paid period
    });
    expect(u).toEqual(expect.objectContaining(PLAN_CHANGE_RULES));
  });

  it("reuses a configuration it already created for the same base settings and products", async () => {
    await ensurePortalConfiguration({ products: PRODUCTS });
    const key = configs.create.mock.calls[0][0].metadata.xprt_portal_key;
    configs.list.mockImplementation((args) => (args?.is_default ? listOf([base()]) : listOf([{ id: "bpc_existing", active: true, metadata: { xprt_portal_key: key } }])));
    configs.create.mockClear();
    await expect(ensurePortalConfiguration({ products: PRODUCTS })).resolves.toBe("bpc_existing");
    expect(configs.create).not.toHaveBeenCalled();
  });

  it("makes a new configuration when the products change (an admin price change) or the Dashboard settings change", async () => {
    await ensurePortalConfiguration({ products: PRODUCTS });
    const k1 = configs.create.mock.calls[0][0].metadata.xprt_portal_key;
    await ensurePortalConfiguration({ products: [{ product: "prod_core", prices: ["price_core_v2"] }, PRODUCTS[1]] });
    const k2 = configs.create.mock.calls[1][0].metadata.xprt_portal_key;
    configs.list.mockImplementation((args) => (args?.is_default ? listOf([base({ invoice_history: { enabled: false } })]) : listOf([])));
    await ensurePortalConfiguration({ products: PRODUCTS });
    const k3 = configs.create.mock.calls[2][0].metadata.xprt_portal_key;
    expect(new Set([k1, k2, k3]).size).toBe(3);
  });

  it("ignores inactive configurations with a matching key", async () => {
    await ensurePortalConfiguration({ products: PRODUCTS });
    const key = configs.create.mock.calls[0][0].metadata.xprt_portal_key;
    configs.list.mockImplementation((args) => (args?.is_default ? listOf([base()]) : listOf([{ id: "bpc_old", active: false, metadata: { xprt_portal_key: key } }])));
    await expect(ensurePortalConfiguration({ products: PRODUCTS })).resolves.toBe("bpc_new");
  });

  it("respects the Dashboard: when plan switching is OFF in the base, the base itself is returned", async () => {
    configs.list.mockImplementation((args) => (args?.is_default ? listOf([base({ subscription_update: { enabled: false } })]) : listOf([])));
    await expect(ensurePortalConfiguration({ products: PRODUCTS })).resolves.toBe("bpc_base");
    expect(configs.create).not.toHaveBeenCalled();
  });

  it("uses an explicit base configuration when given, and fails clearly when there is none", async () => {
    await ensurePortalConfiguration({ products: PRODUCTS, baseConfigurationId: "bpc_base" });
    expect(configs.retrieve).toHaveBeenCalledWith("bpc_base");
    configs.list.mockImplementation(() => listOf([]));
    await expect(ensurePortalConfiguration({ products: PRODUCTS })).rejects.toThrow(/No base Customer Portal configuration/);
  });
});
