import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers fetchAppleState's behaviour when getAllSubscriptionStatuses is unavailable.
 * The ownership tests mock fetchAppleState wholesale, so the fallback itself is only
 * exercised here.
 */

const api = { getAllSubscriptionStatuses: vi.fn(), getTransactionInfo: vi.fn() };
const decode = { transaction: vi.fn(), renewal: vi.fn() };

vi.mock("@apple/app-store-server-library", () => ({
  AppStoreServerAPIClient: class {
    getAllSubscriptionStatuses(...a) { return api.getAllSubscriptionStatuses(...a); }
    getTransactionInfo(...a) { return api.getTransactionInfo(...a); }
  },
  SignedDataVerifier: class {
    verifyAndDecodeTransaction(...a) { return decode.transaction(...a); }
    verifyAndDecodeRenewalInfo(...a) { return decode.renewal(...a); }
  },
  Environment: { SANDBOX: "Sandbox", PRODUCTION: "Production" },
}));
vi.mock("googleapis", () => ({ google: {} }));
vi.mock("@xprtlink/shared/lib/internalFetch.js", () => ({ internalPost: vi.fn() }));

const { fetchAppleState, StoreUnavailableError } = await import("./subscriptionStore.js");

const TX = "2000001240874789";
const DAY = 86400000;
const serverError = () => Object.assign(new Error(""), { httpStatusCode: 500, apiError: 5000001 });

beforeEach(() => {
  process.env.APPLE_ISSUER_ID = "issuer";
  process.env.APPLE_KEY_ID = "key";
  process.env.APPLE_PRIVATE_KEY = "pk";
  process.env.APPLE_BUNDLE_ID = "com.app.xprtlink";
  api.getAllSubscriptionStatuses.mockReset();
  api.getTransactionInfo.mockReset();
  decode.transaction.mockReset();
  decode.renewal.mockReset();
});
/** Make the statuses endpoint behave like Apple's sandbox today: 500 on every attempt. */
const statusesUnavailable = () => api.getAllSubscriptionStatuses.mockRejectedValue(serverError());
const originalTransaction = (tx) => {
  api.getTransactionInfo.mockResolvedValue({ signedTransactionInfo: "signed" });
  decode.transaction.mockResolvedValue(tx);
};

describe("fetchAppleState — statuses endpoint available", () => {
  it("uses the subscription status and renewal info", async () => {
    api.getAllSubscriptionStatuses.mockResolvedValue({
      data: [{ lastTransactions: [{ originalTransactionId: TX, status: 1, signedTransactionInfo: "t", signedRenewalInfo: "r" }] }],
    });
    decode.transaction.mockResolvedValue({ expiresDate: Date.now() + 10 * DAY });
    decode.renewal.mockResolvedValue({ autoRenewStatus: 0 });

    const s = await fetchAppleState(TX);
    expect(s).toMatchObject({ status: 1, cancelAtPeriodEnd: true, source: "statuses" });
    expect(api.getTransactionInfo).not.toHaveBeenCalled();
  });
});

describe("fetchAppleState — statuses endpoint unavailable (Apple sandbox 5000001)", () => {
  it("confirms the chain is live when the original transaction has not expired", async () => {
    statusesUnavailable();
    const expiry = Date.now() + 5 * DAY;
    originalTransaction({ expiresDate: expiry, revocationDate: null });

    const s = await fetchAppleState(TX);
    expect(s).toMatchObject({ status: 1, cancelAtPeriodEnd: null, source: "transaction" });
    expect(s.expiry.getTime()).toBe(expiry);
  });

  it("never reports expired from the original transaction — a renewal may have extended the chain", async () => {
    // This is the fail-open trap: getTransactionInfo describes only the FIRST purchase,
    // so a past expiry says nothing about a chain that has since renewed or resubscribed.
    statusesUnavailable();
    originalTransaction({ expiresDate: Date.now() - 30 * DAY, revocationDate: null });

    await expect(fetchAppleState(TX, { throwOnError: true })).rejects.toBeInstanceOf(StoreUnavailableError);
    await expect(fetchAppleState(TX)).resolves.toBeNull();
  });

  it("treats a revoked original transaction as inconclusive rather than lapsed", async () => {
    statusesUnavailable();
    originalTransaction({ expiresDate: Date.now() + 5 * DAY, revocationDate: Date.now() - DAY });

    await expect(fetchAppleState(TX)).resolves.toBeNull();
  });

  it("reports the store as unreachable when the transaction endpoint fails too", async () => {
    statusesUnavailable();
    api.getTransactionInfo.mockRejectedValue(serverError());

    await expect(fetchAppleState(TX, { throwOnError: true })).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("retries the statuses endpoint before falling back", async () => {
    statusesUnavailable();
    originalTransaction({ expiresDate: Date.now() + DAY, revocationDate: null });

    await fetchAppleState(TX);
    expect(api.getAllSubscriptionStatuses).toHaveBeenCalledTimes(3);
  });
});

describe("fetchAppleState — not configured", () => {
  it("returns null without calling Apple, even in strict mode", async () => {
    delete process.env.APPLE_ISSUER_ID;
    await expect(fetchAppleState(TX, { throwOnError: true })).resolves.toBeNull();
    expect(api.getAllSubscriptionStatuses).not.toHaveBeenCalled();
  });
});
