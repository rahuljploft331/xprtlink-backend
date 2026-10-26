import { describe, expect, it } from "vitest";
import { buildPortalProducts } from "./portalProducts.js";

// price -> product, as Stripe would answer
const PRODUCT = {
  core_new: "prod_core", core_old: "prod_core",
  pro_new: "prod_pro", pro_old: "prod_pro",
  elite_new: "prod_elite", elite_old: "prod_elite",
  legacy_other_product: "prod_legacy",
};
const productOfPrice = async (id) => PRODUCT[id] ?? null;
const plans = [
  { code: "elite", stripePriceId: "elite_new", priceMonthlyCents: 4599 },
  { code: "core", stripePriceId: "core_new", priceMonthlyCents: 899 },
  { code: "professional", stripePriceId: "pro_new", priceMonthlyCents: 2699 },
];

describe("buildPortalProducts", () => {
  it("offers only each plan's LATEST Price, cheapest plan first (admin price change shows up automatically)", async () => {
    const r = await buildPortalProducts({ plans, current: null, productOfPrice });
    expect(r).toEqual([
      { product: "prod_core", prices: ["core_new"] },
      { product: "prod_pro", prices: ["pro_new"] },
      { product: "prod_elite", prices: ["elite_new"] },
    ]);
  });

  it("a subscriber still on an older Price sees their own Price for their own plan and the latest for the others", async () => {
    const r = await buildPortalProducts({ plans, current: { priceId: "pro_old", productId: "prod_pro" }, productOfPrice });
    expect(r).toEqual([
      { product: "prod_core", prices: ["core_new"] },
      { product: "prod_pro", prices: ["pro_old"] }, // listed so Stripe lets them switch; replaces pro_new (one Price per product)
      { product: "prod_elite", prices: ["elite_new"] },
    ]);
  });

  it("never lists two Prices for one Product (Stripe rejects that)", async () => {
    const r = await buildPortalProducts({ plans, current: { priceId: "core_old", productId: "prod_core" }, productOfPrice });
    expect(r.every((x) => x.prices.length === 1)).toBe(true);
    expect(new Set(r.map((x) => x.product)).size).toBe(r.length);
  });

  it("a current Price on a Product that is no longer a plan is still listed (so they can switch away)", async () => {
    const r = await buildPortalProducts({ plans, current: { priceId: "legacy_other_product", productId: "prod_legacy" }, productOfPrice });
    expect(r).toContainEqual({ product: "prod_legacy", prices: ["legacy_other_product"] });
    expect(r).toHaveLength(4);
  });

  it("skips plans without a Stripe Price or whose Product cannot be resolved, and caps at 10 products", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ stripePriceId: `p${i}`, priceMonthlyCents: i }));
    const r = await buildPortalProducts({
      plans: [...many, { code: "no-price", stripePriceId: null }, { stripePriceId: "unknown_price", priceMonthlyCents: 0 }],
      current: null,
      productOfPrice: async (id) => (id.startsWith("p") ? `prod_${id}` : null),
    });
    expect(r).toHaveLength(10);
    expect(r.map((x) => x.product)).not.toContain(null);
  });
});
