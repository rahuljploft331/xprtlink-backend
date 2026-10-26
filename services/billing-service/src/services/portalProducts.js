/**
 * Which Prices the Stripe Customer Portal offers a subscriber when they switch plans.
 *
 * Stripe lets a portal list ONE Price per billing interval for each Product, and only lets a customer switch if their
 * current Price is in the list. So a single shared list cannot show "latest prices only" while also supporting
 * subscribers who signed up on an older Price. We build the list per subscriber instead:
 *   - each plan's CURRENT Price (so an admin price change shows up automatically), except
 *   - for the subscriber's own Product, their own current Price (it must be listed, and it is what they pay today).
 * Plans (products) are ordered cheapest first. The result feeds stripeService.ensurePortalConfiguration.
 *
 * @param {{ plans: {stripePriceId: string, priceMonthlyCents?: number}[],
 *           current?: {priceId?: string, productId?: string} | null,
 *           productOfPrice: (priceId: string) => Promise<string|null> }} args
 * @returns {Promise<{product: string, prices: string[]}[]>}
 */
export async function buildPortalProducts({ plans, current, productOfPrice }) {
  const ordered = [...plans]
    .filter((p) => p?.stripePriceId)
    .sort((a, b) => (a.priceMonthlyCents ?? 0) - (b.priceMonthlyCents ?? 0));

  const priceByProduct = new Map();
  for (const plan of ordered) {
    const product = await productOfPrice(plan.stripePriceId);
    if (product && !priceByProduct.has(product)) priceByProduct.set(product, plan.stripePriceId);
  }
  if (current?.priceId && current?.productId) priceByProduct.set(current.productId, current.priceId);

  // Stripe accepts at most 10 products per portal configuration.
  return [...priceByProduct].slice(0, 10).map(([product, price]) => ({ product, prices: [price] }));
}
