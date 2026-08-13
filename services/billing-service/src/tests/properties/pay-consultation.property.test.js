/**
 * Property tests for payConsultation (Properties 9, 10, 11)
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.5
 *
 * Mock boundary: stripeService.js and @xprtlink/shared/db
 * Strategy: Generate random consultation durations, rates, and payment intent IDs
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../services/stripeService.js", () => ({
  getOrCreateStripeCustomer: vi.fn(),
  attachPaymentMethod: vi.fn(),
  createPreAuthHold: vi.fn(),
  capturePaymentIntent: vi.fn(),
  createAndConfirmPaymentIntent: vi.fn(),
}));

vi.mock("@xprtlink/shared/db", () => ({
  getDb: vi.fn(),
}));

vi.mock("@xprtlink/shared/mappers/billing.mapper.js", () => ({
  toPaymentMethodDto: vi.fn((m) => m),
  toTransactionDto: vi.fn((m) => m),
  toEarningsEntryDto: vi.fn((m) => m),
  toExpertSubscriptionDto: vi.fn((m) => m),
  toSubscriptionPlanDto: vi.fn((m) => m),
}));

vi.mock("@xprtlink/shared/utils/errors.js", () => ({
  badRequest: vi.fn((msg, code) => {
    const err = new Error(msg);
    err.statusCode = 400;
    err.code = code;
    err.message = msg;
    return err;
  }),
  notFound: vi.fn((msg) => {
    const err = new Error(msg);
    err.statusCode = 404;
    err.message = msg;
    return err;
  }),
  conflict: vi.fn((msg) => {
    const err = new Error(msg);
    err.statusCode = 409;
    err.message = msg;
    return err;
  }),
  forbidden: vi.fn((msg) => {
    const err = new Error(msg);
    err.statusCode = 403;
    err.message = msg;
    return err;
  }),
}));

vi.mock("@xprtlink/shared/utils/pagination.js", () => ({
  parsePagination: vi.fn(),
  paginatedResult: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import * as stripeSvc from "../../services/stripeService.js";
import { getDb } from "@xprtlink/shared/db";
import { payConsultation } from "../../services/billingService.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Random UUID for IDs */
const uuidArb = fc.uuid();

/** Random Stripe Customer IDs (cus_*) */
const cusIdArb = fc
  .stringMatching(/^[a-zA-Z0-9]{14,28}$/)
  .map((s) => `cus_${s}`);

/** Random Stripe Payment Method IDs (pm_*) */
const pmIdArb = fc
  .stringMatching(/^[a-zA-Z0-9]{14,28}$/)
  .map((s) => `pm_${s}`);

/** Random Stripe PaymentIntent IDs (pi_*) */
const piIdArb = fc
  .stringMatching(/^[a-zA-Z0-9]{14,28}$/)
  .map((s) => `pi_${s}`);

/** Random duration in seconds (1 second to 2 hours) */
const durationSecondsArb = fc.integer({ min: 1, max: 7200 });

/** Random rate per minute in cents (positive, reasonable range) */
const ratePerMinuteCentsArb = fc.integer({ min: 1, max: 10000 });

/** Random currency codes */
const currencyArb = fc.constantFrom("USD", "EUR", "GBP", "CAD", "AUD");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Computes expected amount matching billingService.computeConsultationChargeCents
 */
function expectedAmountCents(durationSeconds, ratePerMinuteCents) {
  const minutes = durationSeconds / 60;
  return Math.ceil(minutes * ratePerMinuteCents);
}

/**
 * Builds a mock DB for payConsultation tests.
 * The consultation must have status "completed" and billingStatus !== "charged".
 */
function buildMockDb({ consultation, customerProfile, paymentMethod, stripeResultId }) {
  const transactionRecord = {
    id: "txn-" + Math.random().toString(36).slice(2),
    type: "consultation_charge",
    amountCents: expectedAmountCents(consultation.durationSeconds, consultation.ratePerMinuteCents),
    currency: consultation.expert?.currency || "USD",
    status: "succeeded",
    stripePaymentIntentId: stripeResultId,
    metadata: {
      consultationId: consultation.id,
      paymentMethodId: paymentMethod.id,
      customerProfileId: customerProfile.id,
    },
  };

  const tx = {
    transaction: {
      create: vi.fn().mockResolvedValue(transactionRecord),
    },
    consultationCharge: {
      create: vi.fn().mockResolvedValue({}),
    },
    expertEarningsLedger: {
      create: vi.fn().mockResolvedValue({}),
    },
    consultation: {
      update: vi.fn().mockResolvedValue({}),
    },
  };

  const mockDb = {
    consultation: {
      findFirst: vi.fn().mockResolvedValue(consultation),
    },
    customerProfile: {
      findUnique: vi.fn().mockResolvedValue(customerProfile),
    },
    paymentMethod: {
      findFirst: vi.fn().mockResolvedValue(paymentMethod),
    },
    $transaction: vi.fn(async (cb) => cb(tx)),
    _tx: tx,
  };

  getDb.mockReturnValue(mockDb);
  return mockDb;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 9: Capture uses final computed amount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("for any payConsultation call with a stripePaymentIntentId, the Stripe capturePaymentIntent call SHALL pass amountToCaptureCents equal to the final computed charge (Math.ceil(durationSeconds/60 * ratePerMinuteCents))", async () => {
    /**
     * Validates: Requirements 5.1, 5.5
     */
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        uuidArb,
        cusIdArb,
        pmIdArb,
        piIdArb,
        piIdArb,
        durationSecondsArb,
        ratePerMinuteCentsArb,
        currencyArb,
        async (profileId, consultationId, paymentMethodId, cusId, stripePmId, existingPiId, returnedPiId, durationSeconds, ratePerMinuteCents, currency) => {
          vi.clearAllMocks();

          const consultation = {
            id: consultationId,
            customerId: profileId,
            expertId: "expert-1",
            status: "completed",
            billingStatus: "hold_placed",
            charge: null,
            durationSeconds,
            ratePerMinuteCents,
            expert: { currency },
          };

          const customerProfile = {
            id: profileId,
            stripeCustomerId: cusId,
          };

          const paymentMethod = {
            id: paymentMethodId,
            customerProfileId: profileId,
            stripePaymentMethodId: stripePmId,
          };

          buildMockDb({ consultation, customerProfile, paymentMethod, stripeResultId: returnedPiId });

          // Mock Stripe capturePaymentIntent to return a result with the returnedPiId
          stripeSvc.capturePaymentIntent.mockResolvedValue({
            id: returnedPiId,
            status: "succeeded",
          });

          const auth = { customerProfileId: profileId };
          const body = {
            paymentMethodId,
            stripePaymentIntentId: existingPiId,
          };

          await payConsultation(auth, consultationId, body);

          // Assert: capturePaymentIntent called with the exact computed amount
          const computedAmount = expectedAmountCents(durationSeconds, ratePerMinuteCents);

          expect(stripeSvc.capturePaymentIntent).toHaveBeenCalledOnce();
          expect(stripeSvc.capturePaymentIntent).toHaveBeenCalledWith({
            paymentIntentId: existingPiId,
            amountToCaptureCents: computedAmount,
          });

          // Assert: createAndConfirmPaymentIntent was NOT called (capture path)
          expect(stripeSvc.createAndConfirmPaymentIntent).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 10: Direct charge when no prior hold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("for any payConsultation call without a stripePaymentIntentId, a new PaymentIntent SHALL be created via createAndConfirmPaymentIntent with the customer's stripeCustomerId and the payment method's stripePaymentMethodId for the full computed charge", async () => {
    /**
     * Validates: Requirements 5.2
     */
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        uuidArb,
        cusIdArb,
        pmIdArb,
        piIdArb,
        durationSecondsArb,
        ratePerMinuteCentsArb,
        currencyArb,
        async (profileId, consultationId, paymentMethodId, cusId, stripePmId, returnedPiId, durationSeconds, ratePerMinuteCents, currency) => {
          vi.clearAllMocks();

          const consultation = {
            id: consultationId,
            customerId: profileId,
            expertId: "expert-1",
            status: "completed",
            billingStatus: "pending",
            charge: null,
            durationSeconds,
            ratePerMinuteCents,
            expert: { currency },
          };

          const customerProfile = {
            id: profileId,
            stripeCustomerId: cusId,
          };

          const paymentMethod = {
            id: paymentMethodId,
            customerProfileId: profileId,
            stripePaymentMethodId: stripePmId,
          };

          buildMockDb({ consultation, customerProfile, paymentMethod, stripeResultId: returnedPiId });

          // Mock Stripe createAndConfirmPaymentIntent to return a result
          stripeSvc.createAndConfirmPaymentIntent.mockResolvedValue({
            id: returnedPiId,
            status: "succeeded",
          });

          const auth = { customerProfileId: profileId };
          const body = {
            paymentMethodId,
            // No stripePaymentIntentId — triggers direct charge
          };

          await payConsultation(auth, consultationId, body);

          // Assert: createAndConfirmPaymentIntent called with correct params
          const computedAmount = expectedAmountCents(durationSeconds, ratePerMinuteCents);

          expect(stripeSvc.createAndConfirmPaymentIntent).toHaveBeenCalledOnce();
          expect(stripeSvc.createAndConfirmPaymentIntent).toHaveBeenCalledWith({
            customerStripeId: cusId,
            stripePaymentMethodId: stripePmId,
            amountCents: computedAmount,
            currency,
            metadata: { consultationId },
          });

          // Assert: capturePaymentIntent was NOT called (direct charge path)
          expect(stripeSvc.capturePaymentIntent).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 11: Transaction recording after successful payment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("for any successful capture or direct charge, a transaction SHALL be recorded with the Stripe PaymentIntent ID (stripeResult.id), type consultation_charge, and status succeeded", async () => {
    /**
     * Validates: Requirements 5.3
     */
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        uuidArb,
        cusIdArb,
        pmIdArb,
        piIdArb,
        durationSecondsArb,
        ratePerMinuteCentsArb,
        currencyArb,
        fc.boolean(),
        async (profileId, consultationId, paymentMethodId, cusId, stripePmId, stripeResultPiId, durationSeconds, ratePerMinuteCents, currency, useCaptureFlow) => {
          vi.clearAllMocks();

          const consultation = {
            id: consultationId,
            customerId: profileId,
            expertId: "expert-1",
            status: "completed",
            billingStatus: useCaptureFlow ? "hold_placed" : "pending",
            charge: null,
            durationSeconds,
            ratePerMinuteCents,
            expert: { currency },
          };

          const customerProfile = {
            id: profileId,
            stripeCustomerId: cusId,
          };

          const paymentMethod = {
            id: paymentMethodId,
            customerProfileId: profileId,
            stripePaymentMethodId: stripePmId,
          };

          const mockDb = buildMockDb({ consultation, customerProfile, paymentMethod, stripeResultId: stripeResultPiId });

          // Mock whichever Stripe method will be used
          if (useCaptureFlow) {
            stripeSvc.capturePaymentIntent.mockResolvedValue({
              id: stripeResultPiId,
              status: "succeeded",
            });
          } else {
            stripeSvc.createAndConfirmPaymentIntent.mockResolvedValue({
              id: stripeResultPiId,
              status: "succeeded",
            });
          }

          const auth = { customerProfileId: profileId };
          const body = {
            paymentMethodId,
            ...(useCaptureFlow ? { stripePaymentIntentId: `pi_held_${stripeResultPiId.slice(3)}` } : {}),
          };

          await payConsultation(auth, consultationId, body);

          // Assert: $transaction was called
          expect(mockDb.$transaction).toHaveBeenCalledOnce();

          // Assert: transaction.create was called with the correct data
          const txCreateCall = mockDb._tx.transaction.create.mock.calls[0][0];

          expect(txCreateCall.data.type).toBe("consultation_charge");
          expect(txCreateCall.data.status).toBe("succeeded");
          expect(txCreateCall.data.stripePaymentIntentId).toBe(stripeResultPiId);
          expect(txCreateCall.data.amountCents).toBe(expectedAmountCents(durationSeconds, ratePerMinuteCents));
          expect(txCreateCall.data.currency).toBe(currency);
        }
      ),
      { numRuns: 100 }
    );
  });
});
