import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {};
vi.mock("@xprtlink/shared/db", () => ({ getDb: () => db }));
vi.mock("@xprtlink/shared/lib/internalFetch.js", () => ({ internalPost: vi.fn(() => Promise.resolve({})) }));
vi.mock("@xprtlink/shared/lib/email.js", () => ({ sendEmail: vi.fn(), renderEmailTemplate: vi.fn(async () => "") }));
const storeState = { google: vi.fn(), apple: vi.fn() };
vi.mock("./subscriptionStore.js", async (orig) => ({
  ...(await orig()),
  fetchGoogleState: (...a) => storeState.google(...a),
  fetchAppleState: (...a) => storeState.apple(...a),
  reconcileSubscription: async (_d, sub) => sub,
}));

const { activateStoreSubscription } = await import("./subscriptionOwnership.js");
const { checkPurchaseEligibility } = await import("./billingService.js");

const PLANS = {
  core: { id: "p-core", code: "core", name: "Core" },
  professional: { id: "p-pro", code: "professional", name: "Professional" },
  elite: { id: "p-elite", code: "elite", name: "Elite" },
};
const DAY = 86400000;
const now = new Date();
const future = new Date(now.getTime() + 20 * DAY);
const past = new Date(now.getTime() - DAY);

/** Minimal in-memory Prisma stand-in. $transaction is serialised, mirroring pg_advisory_xact_lock. */
function makeDb(rows = []) {
  let queue = Promise.resolve();
  const match = (r, w = {}) =>
    Object.entries(w).every(([k, v]) => {
      if (k === "NOT") return !match(r, v);
      if (v && typeof v === "object" && "not" in v) return r[k] !== v.not;
      if (v && typeof v === "object" && "in" in v) return v.in.includes(r[k]);
      if (v && typeof v === "object" && "gt" in v) return new Date(r[k]) > v.gt;
      return r[k] === v;
    });
  const withPlan = (r, inc) => (inc?.plan ? { ...r, plan: Object.values(PLANS).find((p) => p.id === r.planId) } : { ...r });
  const sub = {
    rows,
    findFirst: async ({ where, include }) => { const r = rows.find((x) => match(x, where)); return r ? withPlan(r, include) : null; },
    findMany: async ({ where, include }) => rows.filter((x) => match(x, where)).map((r) => withPlan(r, include)),
    update: async ({ where, data }) => Object.assign(rows.find((x) => x.id === where.id), data),
    updateMany: async ({ where, data }) => { rows.filter((x) => match(x, where)).forEach((x) => Object.assign(x, data)); },
    upsert: async ({ where, update, create, include }) => {
      const k = where.store_externalSubscriptionId;
      let r = rows.find((x) => x.store === k.store && x.externalSubscriptionId === k.externalSubscriptionId);
      if (r) Object.assign(r, update);
      else { r = { id: `s${rows.length + 1}`, cancelAtPeriodEnd: false, ...create }; rows.push(r); }
      return withPlan(r, include);
    },
  };
  const tx = { expertSubscription: sub, expertProfile: { updateMany: async () => {} }, $executeRaw: async () => 1 };
  return {
    expertSubscription: sub,
    $transaction: (cb) => { const run = queue.then(() => cb(tx)); queue = run.catch(() => {}); return run; },
  };
}

const row = (o) => ({ id: o.id ?? "s0", planId: PLANS[o.plan].id, store: "google", status: "active", currentPeriodEnd: future, cancelAtPeriodEnd: false, ...o });
const claim = (expertProfileId, plan, ext, extra = {}) =>
  activateStoreSubscription(db, { store: "google", externalSubscriptionId: ext, plan: PLANS[plan], expertProfileId, now, periodEnd: future, ...extra });
const reload = (rows) => { Object.keys(db).forEach((k) => delete db[k]); Object.assign(db, makeDb(rows)); };

beforeEach(() => {
  delete process.env.SUBSCRIPTION_ALLOW_TRANSFER;
  storeState.google.mockReset(); storeState.apple.mockReset();
  reload([]);
});

describe("activateStoreSubscription — plan hierarchy", () => {
  it.each([["core", "professional"], ["core", "elite"], ["professional", "elite"]])("%s → %s succeeds and retires the old row", async (from, to) => {
    reload([row({ id: "old", plan: from, expertProfileId: "A", externalSubscriptionId: "tok-old" })]);
    const s = await claim("A", to, "tok-new");
    expect(s.plan.code).toBe(to);
    expect(s.upgradedFrom).toBe(from);
    expect(db.expertSubscription.rows.find((r) => r.id === "old").status).toBe("canceled");
  });

  it.each([["professional", "core"], ["elite", "professional"], ["elite", "core"]])("%s → %s is rejected and changes nothing", async (from, to) => {
    reload([row({ id: "old", plan: from, expertProfileId: "A", externalSubscriptionId: "tok-old" })]);
    await expect(claim("A", to, "tok-new")).rejects.toMatchObject({ code: "SUBSCRIPTION_DOWNGRADE_BLOCKED", statusCode: 409 });
    expect(db.expertSubscription.rows).toHaveLength(1);
    expect(db.expertSubscription.rows[0].status).toBe("active");
  });

  it("buying the same active plan with a new token creates no duplicate", async () => {
    reload([row({ id: "old", plan: "elite", expertProfileId: "A", externalSubscriptionId: "tok-old" })]);
    await expect(claim("A", "elite", "tok-new")).rejects.toMatchObject({ code: "SUBSCRIPTION_ALREADY_ACTIVE" });
    expect(db.expertSubscription.rows).toHaveLength(1);
  });

  it("a cancelled-but-still-active sub is still entitled: downgrade blocked, upgrade allowed", async () => {
    reload([row({ id: "old", plan: "professional", expertProfileId: "A", externalSubscriptionId: "t1", cancelAtPeriodEnd: true })]);
    await expect(claim("A", "core", "t2")).rejects.toMatchObject({ code: "SUBSCRIPTION_DOWNGRADE_BLOCKED" });
    await expect(claim("A", "elite", "t3")).resolves.toMatchObject({ upgradedFrom: "professional" });
  });

  it("an expired subscription follows the repurchase rule: any plan may be bought", async () => {
    reload([row({ id: "old", plan: "elite", expertProfileId: "A", externalSubscriptionId: "t1", currentPeriodEnd: past })]);
    await expect(claim("A", "core", "t2")).resolves.toMatchObject({ plan: { code: "core" }, upgradedFrom: null });
  });

  it("a Google replacement chain (linked token) is not judged as a second subscription", async () => {
    reload([row({ id: "old", plan: "professional", expertProfileId: "A", externalSubscriptionId: "t1" })]);
    await expect(claim("A", "core", "t2", { linkedExternalId: "t1" })).resolves.toMatchObject({ plan: { code: "core" } });
  });
});

describe("activateStoreSubscription — ownership", () => {
  const ownedByA = () => [row({ id: "a1", plan: "professional", expertProfileId: "A", externalSubscriptionId: "tok" })];

  it("Account B cannot claim Account A's active purchase (same or other device — server sees only the purchase)", async () => {
    reload(ownedByA());
    await expect(claim("B", "professional", "tok")).rejects.toMatchObject({
      statusCode: 409,
      code: "SUBSCRIPTION_ALREADY_LINKED",
      details: { title: "Subscription Already Active", store: "google" },
    });
    expect(db.expertSubscription.rows).toHaveLength(1);
    expect(db.expertSubscription.rows[0].expertProfileId).toBe("A");
  });

  it("a client cannot force a transfer; only the explicit server flag can", async () => {
    reload(ownedByA());
    await expect(claim("B", "professional", "tok", { transfer: true })).rejects.toMatchObject({ code: "SUBSCRIPTION_ALREADY_LINKED" });
    process.env.SUBSCRIPTION_ALLOW_TRANSFER = "true";
    await expect(claim("B", "professional", "tok")).resolves.toMatchObject({ expertProfileId: "B" });
  });

  it("Account A on a second device keeps access (same account re-verifies the same purchase)", async () => {
    reload(ownedByA());
    const s = await claim("A", "professional", "tok");
    expect(s.expertProfileId).toBe("A");
    expect(db.expertSubscription.rows).toHaveLength(1);
  });

  it("renewal / restore of the same purchase is idempotent", async () => {
    reload(ownedByA());
    await claim("A", "professional", "tok");
    await claim("A", "professional", "tok");
    expect(db.expertSubscription.rows).toHaveLength(1);
    expect(db.expertSubscription.rows[0].status).toBe("active");
  });

  it("once the previous owner's subscription has expired, another account may claim it", async () => {
    reload([row({ id: "a1", plan: "professional", expertProfileId: "A", externalSubscriptionId: "tok", currentPeriodEnd: past })]);
    const s = await claim("B", "professional", "tok");
    expect(s.expertProfileId).toBe("B");
  });

  it("a cancelled-but-active owner (auto-renew off, period remaining) still blocks other accounts", async () => {
    reload([row({ id: "a1", plan: "professional", expertProfileId: "A", externalSubscriptionId: "tok", cancelAtPeriodEnd: true })]);
    await expect(claim("B", "professional", "tok")).rejects.toMatchObject({ code: "SUBSCRIPTION_ALREADY_LINKED" });
  });

  it("owner's DB period is still in the future but Apple says expired → another account may claim it", async () => {
    reload([row({ id: "a1", plan: "core", store: "apple", expertProfileId: "A", externalSubscriptionId: "tok", cancelAtPeriodEnd: true })]);
    storeState.apple.mockResolvedValue({ status: 2, expiry: new Date(now.getTime() - 60000), cancelAtPeriodEnd: true });
    const s = await claim("B", "core", "tok", { store: "apple" });
    expect(s.expertProfileId).toBe("B");
  });

  it("store still reports the owner active, or answers with no record → still blocked (fail closed)", async () => {
    reload([row({ id: "a1", plan: "core", store: "apple", expertProfileId: "A", externalSubscriptionId: "tok" })]);
    storeState.apple.mockResolvedValue({ status: 1, expiry: future, cancelAtPeriodEnd: false });
    await expect(claim("B", "core", "tok", { store: "apple" })).rejects.toMatchObject({ code: "SUBSCRIPTION_ALREADY_LINKED" });
    storeState.apple.mockResolvedValue(null);
    await expect(claim("B", "core", "tok", { store: "apple" })).rejects.toMatchObject({ code: "SUBSCRIPTION_ALREADY_LINKED" });
  });

  it("store unreachable → still blocked, but as a retryable 503 rather than an ownership verdict", async () => {
    reload([row({ id: "a1", plan: "core", store: "apple", expertProfileId: "A", externalSubscriptionId: "tok" })]);
    storeState.apple.mockRejectedValue(new Error("apple store state unavailable"));
    await expect(claim("B", "core", "tok", { store: "apple" })).rejects.toMatchObject({
      statusCode: 503,
      code: "STORE_VERIFICATION_FAILED",
    });
    // The owner keeps the purchase and nothing is written.
    expect(db.expertSubscription.rows).toHaveLength(1);
    expect(db.expertSubscription.rows[0].expertProfileId).toBe("A");
    expect(db.expertSubscription.rows[0].status).toBe("active");
  });

  it("owner's stored period is synthetic but the store says expired → the claim succeeds", async () => {
    // Sandbox grants a 30-day period end, so the stored row still looks active.
    reload([row({ id: "a1", plan: "core", store: "apple", expertProfileId: "A", externalSubscriptionId: "tok" })]);
    storeState.apple.mockResolvedValue({ status: 1, expiry: past, cancelAtPeriodEnd: null });
    const s = await claim("B", "core", "tok", { store: "apple" });
    expect(s.expertProfileId).toBe("B");
    expect(db.expertSubscription.rows).toHaveLength(1);
  });

  it("two simultaneous claims of one new purchase cannot both succeed", async () => {
    const results = await Promise.allSettled([claim("A", "core", "tok-race"), claim("B", "core", "tok-race")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")[0].reason.code).toBe("SUBSCRIPTION_ALREADY_LINKED");
    const owners = db.expertSubscription.rows.filter((r) => r.externalSubscriptionId === "tok-race");
    expect(owners).toHaveLength(1);
  });
});

describe("checkPurchaseEligibility", () => {
  const auth = { userId: "uB", expertProfileId: "B" };

  it("blocks with an alert payload when the device's purchase belongs to another account", async () => {
    reload([row({ id: "a1", plan: "professional", expertProfileId: "A", externalSubscriptionId: "tok" })]);
    const r = await checkPurchaseEligibility(auth, { planCode: "professional", store: "google", purchaseToken: "tok" });
    expect(r).toMatchObject({ eligible: false, code: "SUBSCRIPTION_ALREADY_LINKED", title: "Subscription Already Active", store: "google" });
    expect(r.managementUrl).toMatch(/^https:\/\/play\.google\.com\//);
    expect(r.alertMessage).toMatch(/associated with another account/);
    expect(storeState.google).toHaveBeenCalledWith("tok", { throwOnError: true }); // owner liveness is checked with the store (fails closed)
  });

  it("reports a retryable store failure instead of an ownership verdict when the store is unreachable", async () => {
    reload([row({ id: "a1", plan: "professional", expertProfileId: "A", externalSubscriptionId: "tok" })]);
    storeState.google.mockRejectedValue(new Error("google store state unavailable"));
    const r = await checkPurchaseEligibility(auth, { planCode: "professional", store: "google", purchaseToken: "tok" });
    expect(r).toMatchObject({ eligible: false, code: "STORE_VERIFICATION_FAILED", retryable: true });
    expect(r.alertMessage).toBeUndefined();
  });

  it("with SUBSCRIPTION_ALLOW_TRANSFER the pre-check agrees with activate and lets the purchase through", async () => {
    // Without this the client is told "not eligible" and never reaches verify,
    // so the transfer that activateStoreSubscription would allow never happens.
    reload([row({ id: "a1", plan: "professional", expertProfileId: "A", externalSubscriptionId: "tok" })]);
    storeState.google.mockResolvedValue({ state: "SUBSCRIPTION_STATE_ACTIVE", expiry: future });
    process.env.SUBSCRIPTION_ALLOW_TRANSFER = "true";
    const r = await checkPurchaseEligibility(auth, { planCode: "professional", store: "google", purchaseToken: "tok" });
    expect(r).toMatchObject({ eligible: true });
    expect(r.code).toBeFalsy();
  });

  it("fails closed when an unknown purchase cannot be verified with the store", async () => {
    storeState.google.mockResolvedValue(null);
    const r = await checkPurchaseEligibility(auth, { planCode: "core", store: "google", purchaseToken: "mystery" });
    expect(r).toMatchObject({ eligible: false, code: "STORE_VERIFICATION_FAILED" });
  });

  it("an unknown but store-verified purchase does not block", async () => {
    storeState.google.mockResolvedValue({ state: "SUBSCRIPTION_STATE_EXPIRED" });
    const r = await checkPurchaseEligibility(auth, { planCode: "core", store: "google", purchaseToken: "old" });
    expect(r).toMatchObject({ eligible: true, action: "purchase" });
  });

  it("own subscription: upgrade allowed with the Google replacement token, downgrade blocked, same blocked", async () => {
    reload([row({ id: "b1", plan: "professional", expertProfileId: "B", externalSubscriptionId: "tok-b" })]);
    const up = await checkPurchaseEligibility(auth, { planCode: "elite" });
    expect(up).toMatchObject({ eligible: true, action: "upgrade", upgrade: { store: "google", oldPurchaseToken: "tok-b", toPlanCode: "elite" } });
    expect(await checkPurchaseEligibility(auth, { planCode: "core" })).toMatchObject({ eligible: false, code: "SUBSCRIPTION_DOWNGRADE_BLOCKED" });
    expect(await checkPurchaseEligibility(auth, { planCode: "professional" })).toMatchObject({ eligible: false, code: "SUBSCRIPTION_ALREADY_ACTIVE" });
  });

  it("legacy callers without planCode keep the old ACTIVE_SUBSCRIPTION block", async () => {
    reload([row({ id: "b1", plan: "core", expertProfileId: "B", externalSubscriptionId: "tok-b" })]);
    expect(await checkPurchaseEligibility(auth)).toMatchObject({ eligible: false, reason: "ACTIVE_SUBSCRIPTION" });
  });

  it("an expired subscription leaves the account free to buy any plan", async () => {
    reload([row({ id: "b1", plan: "elite", expertProfileId: "B", externalSubscriptionId: "tok-b", currentPeriodEnd: past })]);
    expect(await checkPurchaseEligibility(auth, { planCode: "core" })).toMatchObject({ eligible: true });
  });
});
