import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
// Stripe and the DB are faked per test; notifications/email are no-ops.

const db = {};
vi.mock("@xprtlink/shared/db", () => ({ getDb: () => db }));
vi.mock("@xprtlink/shared/lib/internalFetch.js", () => ({
  internalPost: vi.fn(() => Promise.resolve({})),
  internalGet: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@xprtlink/shared/lib/email.js", () => ({ sendEmail: vi.fn(() => Promise.resolve()) }));
vi.mock("./stripeService.js", () => ({
  retrievePaymentIntent: vi.fn(),
  capturePaymentIntent: vi.fn(),
  createAndConfirmPaymentIntent: vi.fn(),
  cancelPaymentIntent: vi.fn(),
  getConnectAccountStatus: vi.fn(),
  getAvailableBalanceCents: vi.fn(),
  transferEarningsToExpertPayout: vi.fn(),
  findTransferForPayout: vi.fn(() => Promise.resolve(null)),
  createRecipientAccount: vi.fn(),
  createOnboardingLink: vi.fn(),
  createDashboardLoginLink: vi.fn(),
  constructWebhookEvent: vi.fn(),
  listRefundsForCharge: vi.fn(),
}));

const stripe = await import("./stripeService.js");
const {
  captureConsultation,
  releaseConsultationHold,
  runPayouts,
  isPayoutDue,
  payExpertNow,
  retryPayout,
  getConnectOnboardingLink,
  getConnectStatus,
  submitCustomConnectKyc,
  handleStripeWebhook,
} = await import(
  "./billingService.js"
);

function resetDb() {
  for (const key of Object.keys(db)) delete db[key];
  Object.assign(db, {
    consultation: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    platformSetting: { findUnique: vi.fn(() => null) },
    customerProfile: { findUnique: vi.fn(() => ({ stripeCustomerId: "cus_default" })) },
    paymentMethod: { findFirst: vi.fn(() => ({ stripePaymentMethodId: "pm_default" })) },
    transaction: { create: vi.fn(({ data }) => ({ id: `txn_${data.stripePaymentIntentId}`, ...data })) },
    consultationCharge: { create: vi.fn() },
    expertEarningsLedger: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    expertProfile: { findUnique: vi.fn(), updateMany: vi.fn() },
    expertPayout: {
      findFirst: vi.fn(() => null),
      create: vi.fn(({ data }) => ({ id: "payout_1", ...data })),
      update: vi.fn(({ data }) => ({ id: "payout_1", amountCents: 0, ...data })),
    },
    $transaction: vi.fn((fn) => fn(db)),
  });
}

/** $30 / 30 min listed rate → 100¢ per billable minute. */
function consultation(overrides = {}) {
  return {
    id: "c1",
    customerId: "cust1",
    expertId: "exp1",
    status: "completed",
    billingStatus: "pending",
    ratePerMinuteCents: 3000,
    durationSeconds: 600,
    stripePaymentIntentId: "pi_hold",
    expert: { currency: "USD" },
    charge: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDb();
});

// ── Settlement ───────────────────────────────────────────────────────────────

describe("captureConsultation — settlement from the pre-call hold", () => {
  it("captures only the billed amount when the call fits inside the hold", async () => {
    db.consultation.findUnique.mockResolvedValue(consultation());
    stripe.retrievePaymentIntent.mockResolvedValue({ id: "pi_hold", status: "requires_capture", amount_capturable: 3000 });
    stripe.capturePaymentIntent.mockResolvedValue({ id: "pi_hold", status: "succeeded", amount_received: 1000 });

    const result = await captureConsultation("c1", 600); // 10 min → $10

    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith({ paymentIntentId: "pi_hold", amountToCaptureCents: 1000 });
    expect(stripe.createAndConfirmPaymentIntent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ captured: true, amountCents: 1000, commissionCents: 150, expertShareCents: 850 });
    expect(db.expertEarningsLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ grossCents: 1000, commissionCents: 150, netCents: 850 }),
    });
  });

  it("captures the full hold and charges the overage to the same card when the call outgrows it", async () => {
    db.consultation.findUnique.mockResolvedValue(consultation());
    stripe.retrievePaymentIntent.mockResolvedValue({
      id: "pi_hold",
      status: "requires_capture",
      amount_capturable: 3000,
      customer: "cus_hold",
      payment_method: "pm_hold",
    });
    stripe.capturePaymentIntent.mockResolvedValue({
      id: "pi_hold",
      status: "succeeded",
      amount_received: 3000,
      customer: "cus_hold",
      payment_method: "pm_hold",
    });
    stripe.createAndConfirmPaymentIntent.mockResolvedValue({ id: "pi_extra", status: "succeeded" });

    const result = await captureConsultation("c1", 3600); // 60 min → $60, hold covers $30

    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith({ paymentIntentId: "pi_hold", amountToCaptureCents: 3000 });
    expect(stripe.createAndConfirmPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ customerStripeId: "cus_hold", stripePaymentMethodId: "pm_hold", amountCents: 3000 })
    );
    expect(db.transaction.create).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ captured: true, amountCents: 6000, shortfallCents: 0 });
    expect(db.expertEarningsLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ grossCents: 6000, commissionCents: 900, netCents: 5100 }),
    });
  });

  it("does not capture again when the hold was already captured (DB write failed last time)", async () => {
    db.consultation.findUnique.mockResolvedValue(consultation());
    stripe.retrievePaymentIntent.mockResolvedValue({ id: "pi_hold", status: "succeeded", amount_received: 1000 });

    const result = await captureConsultation("c1", 600);

    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled();
    expect(stripe.createAndConfirmPaymentIntent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ captured: true, amountCents: 1000 });
  });

  it("charges the default card off-session when the hold has expired", async () => {
    db.consultation.findUnique.mockResolvedValue(consultation());
    stripe.retrievePaymentIntent.mockResolvedValue({ id: "pi_hold", status: "canceled" });
    stripe.createAndConfirmPaymentIntent.mockResolvedValue({ id: "pi_direct", status: "succeeded" });

    const result = await captureConsultation("c1", 600);

    expect(stripe.createAndConfirmPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ customerStripeId: "cus_default", stripePaymentMethodId: "pm_default", amountCents: 1000 })
    );
    expect(result).toMatchObject({ captured: true, amountCents: 1000 });
  });

  it("settles on what was collected and flags the shortfall when the overage is declined", async () => {
    db.consultation.findUnique.mockResolvedValue(consultation());
    stripe.retrievePaymentIntent.mockResolvedValue({
      id: "pi_hold",
      status: "requires_capture",
      amount_capturable: 3000,
      customer: "cus_hold",
      payment_method: "pm_hold",
    });
    stripe.capturePaymentIntent.mockResolvedValue({ id: "pi_hold", status: "succeeded", amount_received: 3000 });
    stripe.createAndConfirmPaymentIntent.mockRejectedValue(new Error("Your card was declined."));

    const result = await captureConsultation("c1", 3600);

    expect(result).toMatchObject({ captured: true, amountCents: 3000, shortfallCents: 3000 });
    expect(db.expertEarningsLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ grossCents: 3000 }),
    });
  });

  it("marks billing failed and records nothing when no money could be collected", async () => {
    db.consultation.findUnique.mockResolvedValue(consultation());
    stripe.retrievePaymentIntent.mockResolvedValue({ id: "pi_hold", status: "canceled" });
    stripe.createAndConfirmPaymentIntent.mockRejectedValue(new Error("Your card was declined."));

    const result = await captureConsultation("c1", 600);

    expect(result).toMatchObject({ captured: false, reason: "stripe_capture_failed" });
    expect(db.consultation.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", billingStatus: { not: "charged" } },
      data: { billingStatus: "failed" },
    });
    expect(db.expertEarningsLedger.create).not.toHaveBeenCalled();
  });

  it("skips a consultation that is already charged", async () => {
    db.consultation.findUnique.mockResolvedValue(consultation({ billingStatus: "charged" }));
    const result = await captureConsultation("c1", 600);
    expect(result).toEqual({ skipped: true, reason: "already_charged" });
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it("reads commission from platform settings even when stored as a string", async () => {
    db.platformSetting.findUnique.mockResolvedValue({ key: "commissionPercent", value: "20" });
    db.consultation.findUnique.mockResolvedValue(consultation());
    stripe.retrievePaymentIntent.mockResolvedValue({ id: "pi_hold", status: "succeeded", amount_received: 1000 });

    const result = await captureConsultation("c1", 600);
    expect(result).toMatchObject({ commissionCents: 200, expertShareCents: 800 });
  });
});

describe("releaseConsultationHold", () => {
  it("cancels the hold of a declined consultation and stamps holdReleasedAt", async () => {
    db.consultation.findUnique.mockResolvedValue(consultation({ status: "declined", holdReleasedAt: null }));
    stripe.cancelPaymentIntent.mockResolvedValue({ id: "pi_hold", status: "canceled" });

    const result = await releaseConsultationHold("c1");

    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith("pi_hold");
    expect(result).toEqual({ released: true, paymentIntentId: "pi_hold" });
    expect(db.consultation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { holdReleasedAt: expect.any(Date) },
    });
  });

  it("never releases the hold of a consultation that is still active", async () => {
    db.consultation.findUnique.mockResolvedValue(consultation({ status: "in_progress", holdReleasedAt: null }));
    const result = await releaseConsultationHold("c1");
    expect(result).toEqual({ released: false, reason: "not_terminal" });
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
  });

  it("does not mark a captured PaymentIntent as released", async () => {
    db.consultation.findUnique.mockResolvedValue(consultation({ status: "failed", holdReleasedAt: null }));
    stripe.cancelPaymentIntent.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
    const result = await releaseConsultationHold("c1");
    expect(result).toEqual({ released: false, reason: "captured_without_charge" });
    expect(db.consultation.update).not.toHaveBeenCalled();
  });
});

// ── Payouts ──────────────────────────────────────────────────────────────────

describe("isPayoutDue — per-expert N-day cadence", () => {
  const cutoff = new Date("2026-10-02T00:00:00Z");
  it("is due for an expert who has never been paid", () => {
    expect(isPayoutDue(null, 7, cutoff)).toBe(true);
  });
  it("is due exactly N days after the day of the last payout", () => {
    expect(isPayoutDue(new Date("2026-09-25T02:15:00Z"), 7, cutoff)).toBe(true);
  });
  it("is not due before N days have passed", () => {
    expect(isPayoutDue(new Date("2026-09-26T02:15:00Z"), 7, cutoff)).toBe(false);
  });
  it("pays daily when N=1", () => {
    expect(isPayoutDue(new Date("2026-10-01T02:15:00Z"), 1, cutoff)).toBe(true);
  });
});

describe("runPayouts", () => {
  const now = new Date("2026-10-02T02:15:00Z");
  const readyExpert = { stripeAccountId: "acct_1", currency: "USD", userId: "u1" };

  beforeEach(() => {
    stripe.getConnectAccountStatus.mockResolvedValue({ transfersActive: true, requirementsDue: [] });
    stripe.getAvailableBalanceCents.mockResolvedValue({ availableCents: 100000, pendingCents: 0 });
    stripe.transferEarningsToExpertPayout.mockResolvedValue({ id: "tr_1" });
    db.expertProfile.findUnique.mockResolvedValue(readyExpert);
    db.expertEarningsLedger.updateMany.mockImplementation(({ where }) => ({ count: where.id.in.length }));
  });

  it("pays ALL unpaid earnings before today's cut-off, however old", async () => {
    db.expertEarningsLedger.findMany.mockResolvedValue([
      { id: "l1", expertProfileId: "exp1", netCents: 500, createdAt: new Date("2026-08-01T10:00:00Z") },
      { id: "l2", expertProfileId: "exp1", netCents: 300, createdAt: new Date("2026-10-01T10:00:00Z") },
    ]);

    const summary = await runPayouts({ now });

    const query = db.expertEarningsLedger.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ payoutId: null, holdReason: null, createdAt: { lt: new Date("2026-10-02T00:00:00Z") } });
    expect(stripe.transferEarningsToExpertPayout).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 800, destinationStripeAccountId: "acct_1", payoutId: "payout_1" })
    );
    expect(summary).toMatchObject({ payoutsCreated: 1, transfersSucceeded: 1, totalCents: 800 });
  });

  it("waits until the expert's cadence is due", async () => {
    db.expertEarningsLedger.findMany.mockResolvedValue([
      { id: "l1", expertProfileId: "exp1", netCents: 500, createdAt: new Date("2026-10-01T10:00:00Z") },
    ]);
    db.expertPayout.findFirst.mockResolvedValue({ createdAt: new Date("2026-09-28T02:15:00Z") });

    const summary = await runPayouts({ now });
    expect(summary.skippedNotDue).toBe(1);
    expect(db.expertPayout.create).not.toHaveBeenCalled();
  });

  it("leaves earnings unpaid (no failed payout) when Stripe transfers are inactive", async () => {
    db.expertEarningsLedger.findMany.mockResolvedValue([
      { id: "l1", expertProfileId: "exp1", netCents: 500, createdAt: new Date("2026-10-01T10:00:00Z") },
    ]);
    stripe.getConnectAccountStatus.mockResolvedValue({ transfersActive: false, requirementsDue: ["individual.phone"] });

    const summary = await runPayouts({ now });
    expect(summary.skippedTransfersInactive).toBe(1);
    expect(db.expertPayout.create).not.toHaveBeenCalled();
  });

  it("leaves earnings unpaid while the platform's available balance cannot cover them", async () => {
    db.expertEarningsLedger.findMany.mockResolvedValue([
      { id: "l1", expertProfileId: "exp1", netCents: 500, createdAt: new Date("2026-10-01T10:00:00Z") },
    ]);
    stripe.getAvailableBalanceCents.mockResolvedValue({ availableCents: 100, pendingCents: 1800 });

    const summary = await runPayouts({ now });
    expect(summary.skippedInsufficientBalance).toBe(1);
    expect(stripe.transferEarningsToExpertPayout).not.toHaveBeenCalled();
  });
});

describe("payExpertNow — admin manual payout", () => {
  it("refuses with a clear reason when the Connect account cannot receive transfers", async () => {
    db.expertProfile.findUnique.mockResolvedValue({ stripeAccountId: "acct_1", currency: "USD" });
    db.expertEarningsLedger.findMany.mockResolvedValue([{ id: "l1", netCents: 399, createdAt: new Date() }]);
    stripe.getConnectAccountStatus.mockResolvedValue({ transfersActive: false, requirementsDue: ["individual.phone"] });

    await expect(payExpertNow("exp1")).rejects.toMatchObject({ statusCode: 400, code: "CONNECT_NOT_READY" });
    expect(db.expertPayout.create).not.toHaveBeenCalled();
  });

  it("refuses when there is nothing to pay", async () => {
    db.expertProfile.findUnique.mockResolvedValue({ stripeAccountId: "acct_1", currency: "USD" });
    db.expertEarningsLedger.findMany.mockResolvedValue([]);
    await expect(payExpertNow("exp1")).rejects.toMatchObject({ code: "NOTHING_TO_PAY" });
  });
});

describe("retryPayout — reconciliation", () => {
  it("adopts a transfer that already went out instead of sending a second one", async () => {
    db.expertPayout.findUnique = vi.fn().mockResolvedValue({
      id: "payout_1",
      expertProfileId: "exp1",
      amountCents: 500,
      currency: "USD",
      status: "failed",
      _count: { ledgerEntries: 2 },
    });
    db.expertProfile.findUnique.mockResolvedValue({ stripeAccountId: "acct_1", currency: "USD", userId: "u1" });
    // The transfer that went out drained the balance — reconciliation must not need it.
    stripe.getAvailableBalanceCents.mockResolvedValue({ availableCents: 0, pendingCents: 0 });
    stripe.findTransferForPayout.mockResolvedValue({ id: "tr_existing", reversed: false });

    const result = await retryPayout("payout_1");

    expect(stripe.transferEarningsToExpertPayout).not.toHaveBeenCalled();
    expect(db.expertPayout.update).toHaveBeenCalledWith({
      where: { id: "payout_1" },
      data: { status: "paid", stripeTransferId: "tr_existing" },
    });
    expect(result.transferred).toBe(true);
  });
});

// ── Stripe-hosted payout onboarding ─────────────────────────────────────────

describe("getConnectOnboardingLink", () => {
  const auth = { expertProfileId: "exp1" };
  const base = { returnBaseUrl: "https://api.example.com/" };

  it("creates one v2 recipient account on first use and links to it", async () => {
    db.expertProfile.findUnique
      .mockResolvedValueOnce({ id: "exp1", firstName: "Ana", lastName: "Lee", stripeAccountId: null, user: { email: "ana@x.com" } })
      .mockResolvedValueOnce({ stripeAccountId: "acct_new" });
    stripe.createRecipientAccount.mockResolvedValue({ id: "acct_new" });
    stripe.createOnboardingLink.mockResolvedValue({ url: "https://connect.stripe.com/x", expiresAt: "t" });

    const link = await getConnectOnboardingLink(auth, base);

    expect(stripe.createRecipientAccount).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ana@x.com", expertProfileId: "exp1" })
    );
    // Guarded write: a concurrent tap can't overwrite a stored account id.
    expect(db.expertProfile.updateMany).toHaveBeenCalledWith({
      where: { id: "exp1", stripeAccountId: null },
      data: { stripeAccountId: "acct_new", stripeTransfersActive: false },
    });
    expect(stripe.createOnboardingLink).toHaveBeenCalledWith({
      stripeAccountId: "acct_new",
      legacyCustom: false,
      returnUrl: "https://api.example.com/api/v1/billing/connect/return",
      refreshUrl: "https://api.example.com/api/v1/billing/connect/refresh",
    });
    expect(link.url).toBe("https://connect.stripe.com/x");
  });

  it("never creates a second account; legacy Custom accounts get the v1 hosted form", async () => {
    db.expertProfile.findUnique.mockResolvedValueOnce({ id: "exp1", stripeAccountId: "acct_old", user: {} });
    stripe.getConnectAccountStatus.mockResolvedValue({ legacyCustom: true, transfersActive: false, requirementsDue: [] });
    stripe.createOnboardingLink.mockResolvedValue({ url: "u", expiresAt: "t" });

    await getConnectOnboardingLink(auth, base);

    expect(stripe.createRecipientAccount).not.toHaveBeenCalled();
    expect(stripe.createOnboardingLink).toHaveBeenCalledWith(
      expect.objectContaining({ stripeAccountId: "acct_old", legacyCustom: true })
    );
  });
});

describe("getConnectStatus", () => {
  const auth = { expertProfileId: "exp1" };

  it("reports not_started when the expert has no Stripe account", async () => {
    db.expertProfile.findUnique.mockResolvedValue({ id: "exp1", stripeAccountId: null });
    const status = await getConnectStatus(auth);
    expect(status).toMatchObject({ hasAccount: false, onboardingStatus: "not_started", payoutsActive: false });
  });

  it.each([
    [{ transfersActive: true, requirementsDue: [] }, "active"],
    [{ transfersActive: false, requirementsDue: ["external_account"] }, "action_required"],
    [{ transfersActive: false, requirementsDue: [] }, "under_review"],
  ])("maps Stripe state %j to %s and caches readiness", async (stripeState, expected) => {
    db.expertProfile.findUnique.mockResolvedValue({ id: "exp1", stripeAccountId: "acct_1" });
    stripe.getConnectAccountStatus.mockResolvedValue({ legacyCustom: false, bankLast4: "6789", ...stripeState });

    const status = await getConnectStatus(auth);

    expect(status.onboardingStatus).toBe(expected);
    expect(db.expertProfile.updateMany).toHaveBeenCalledWith({
      where: { stripeAccountId: "acct_1" },
      data: { stripeTransfersActive: stripeState.transfersActive, stripeStatusCheckedAt: expect.any(Date) },
    });
  });
});

describe("legacy in-app KYC form", () => {
  it("tells an old app build to update when the account came from hosted onboarding", async () => {
    db.expertProfile.findUnique.mockResolvedValue({ id: "exp1", stripeAccountId: "acct_v2", user: { email: "a@x.com" } });
    stripe.getConnectAccountStatus.mockResolvedValue({ legacyCustom: false });

    await expect(submitCustomConnectKyc({ expertProfileId: "exp1" }, {})).rejects.toMatchObject({
      statusCode: 409,
      code: "UPDATE_APP_FOR_PAYOUT_SETUP",
    });
  });
});

// ── Chargebacks and Stripe-Dashboard refunds (webhooks) ─────────────────────

describe("webhooks — disputes and refunds", () => {
  const deliver = (type, object) => {
    stripe.constructWebhookEvent.mockReturnValue({ id: `evt_${type}`, type, data: { object } });
    return handleStripeWebhook("raw", "sig");
  };

  beforeEach(() => {
    Object.assign(db, {
      processedWebhookEvent: { findUnique: vi.fn(() => null), create: vi.fn(() => Promise.resolve()) },
      consultationCharge: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      expertEarningsLedger: { ...db.expertEarningsLedger, findFirst: vi.fn(), deleteMany: vi.fn() },
      transaction: {
        ...db.transaction,
        findUnique: vi.fn(() => ({ id: "txn1", currency: "USD", metadata: { consultationId: "c1", customerProfileId: "cust1" } })),
        findMany: vi.fn(() => []),
        update: vi.fn(),
      },
    });
    db.consultationCharge.findUnique.mockResolvedValue({ consultationId: "c1", transactionId: "txn1" });
  });

  it("dispute opened: holds the expert's unpaid earning", async () => {
    db.expertEarningsLedger.findFirst.mockResolvedValue({ id: "l1", payoutId: null });

    await deliver("charge.dispute.created", { id: "dp_1", payment_intent: "pi_1", amount: 4000, reason: "fraudulent" });

    expect(db.consultationCharge.update).toHaveBeenCalledWith({
      where: { consultationId: "c1" },
      data: expect.objectContaining({ disputeStatus: "open", stripeDisputeId: "dp_1" }),
    });
    expect(db.expertEarningsLedger.updateMany).toHaveBeenCalledWith({
      where: { consultationId: "c1", payoutId: null },
      data: { holdReason: "dispute" },
    });
  });

  it("dispute opened after payout: flags the charge for admin review", async () => {
    db.expertEarningsLedger.findFirst.mockResolvedValue({ id: "l1", payoutId: "payout_9" });

    await deliver("charge.dispute.created", { id: "dp_1", payment_intent: "pi_1", amount: 4000, reason: "fraudulent" });

    expect(db.consultationCharge.update).toHaveBeenCalledWith({
      where: { consultationId: "c1" },
      data: expect.objectContaining({ disputeStatus: "open", needsReview: true }),
    });
  });

  it("dispute won: releases the hold", async () => {
    db.expertEarningsLedger.findFirst.mockResolvedValue({ id: "l1", payoutId: null });

    await deliver("charge.dispute.closed", { id: "dp_1", payment_intent: "pi_1", amount: 4000, status: "won" });

    expect(db.expertEarningsLedger.updateMany).toHaveBeenCalledWith({
      where: { consultationId: "c1", holdReason: "dispute" },
      data: { holdReason: null },
    });
    expect(db.expertEarningsLedger.deleteMany).not.toHaveBeenCalled();
  });

  it("dispute lost: platform absorbs it — the expert's unpaid earning is cancelled", async () => {
    db.expertEarningsLedger.findFirst.mockResolvedValue({ id: "l1", payoutId: null });

    await deliver("charge.dispute.closed", { id: "dp_1", payment_intent: "pi_1", amount: 4000, status: "lost" });

    expect(db.consultationCharge.update).toHaveBeenCalledWith({
      where: { consultationId: "c1" },
      data: { disputeStatus: "lost" },
    });
    expect(db.expertEarningsLedger.deleteMany).toHaveBeenCalledWith({ where: { consultationId: "c1", payoutId: null } });
  });

  it("refund made in the admin portal is ignored (already recorded)", async () => {
    stripe.listRefundsForCharge.mockResolvedValue([{ id: "re_1", amount: 4000, status: "succeeded", metadata: { source: "xprtlink_admin" } }]);

    await deliver("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount: 4000, amount_refunded: 4000, refunded: true });

    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(db.consultation.update).not.toHaveBeenCalled();
  });

  it("full refund made in the Stripe Dashboard: records it and cancels the unpaid earning", async () => {
    db.expertEarningsLedger.findFirst.mockResolvedValue({ id: "l1", payoutId: null });
    stripe.listRefundsForCharge.mockResolvedValue([{ id: "re_2", amount: 4000, status: "succeeded", metadata: {} }]);
    db.transaction.findMany
      .mockResolvedValueOnce([]) // no refund recorded yet
      .mockResolvedValueOnce([{ status: "refunded" }]); // every charge of the call now refunded

    await deliver("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount: 4000, amount_refunded: 4000, refunded: true });

    expect(db.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "refund", amountCents: 4000, metadata: expect.objectContaining({ stripeRefundId: "re_2", source: "stripe_dashboard" }) }),
    });
    expect(db.transaction.update).toHaveBeenCalledWith({ where: { id: "txn1" }, data: { status: "refunded" } });
    expect(db.expertEarningsLedger.deleteMany).toHaveBeenCalledWith({ where: { consultationId: "c1", payoutId: null } });
    expect(db.consultation.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { billingStatus: "refunded" } });
  });

  it("partial Dashboard refund: recorded and flagged for review, earning untouched", async () => {
    db.expertEarningsLedger.findFirst.mockResolvedValue({ id: "l1", payoutId: null });
    stripe.listRefundsForCharge.mockResolvedValue([{ id: "re_3", amount: 1000, status: "succeeded", metadata: {} }]);
    db.transaction.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: "succeeded" }]);

    await deliver("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount: 4000, amount_refunded: 1000, refunded: false });

    expect(db.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "refund", amountCents: 1000 }) });
    expect(db.expertEarningsLedger.deleteMany).not.toHaveBeenCalled();
    expect(db.consultationCharge.update).toHaveBeenCalledWith({
      where: { consultationId: "c1" },
      data: expect.objectContaining({ needsReview: true }),
    });
  });

  it("the same Dashboard refund delivered twice is recorded once", async () => {
    stripe.listRefundsForCharge.mockResolvedValue([{ id: "re_2", amount: 4000, status: "succeeded", metadata: {} }]);
    db.transaction.findMany.mockResolvedValueOnce([{ metadata: { stripeRefundId: "re_2" } }]);

    await deliver("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount: 4000, amount_refunded: 4000, refunded: true });

    expect(db.transaction.create).not.toHaveBeenCalled();
  });
});

describe("payouts skip held earnings", () => {
  it("runPayouts only picks earnings with no hold", async () => {
    db.expertEarningsLedger.findMany.mockResolvedValue([]);
    await runPayouts({ now: new Date("2026-10-02T02:15:00Z") });
    expect(db.expertEarningsLedger.findMany.mock.calls[0][0].where).toMatchObject({ payoutId: null, holdReason: null });
  });
});
