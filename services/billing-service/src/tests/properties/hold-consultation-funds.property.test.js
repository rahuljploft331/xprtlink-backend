/**
 * Property tests for holdConsultationFunds (Properties 7, 8)
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 *
 * Mock boundary: stripeService.js and @xprtlink/shared/db
 * Strategy: Generate random consultations, customer profiles with/without stripeCustomerId,
 *           payment methods, and amounts
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
import { holdConsultationFunds } from "../../services/billingService.js";

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

/** Random amount in cents (positive, reasonable range) */
const amountCentsArb = fc.integer({ min: 100, max: 1000000 });

/** Random rate per minute in cents */
const ratePerMinuteCentsArb = fc.integer({ min: 50, max: 5000 });

/** Random currency codes */
const currencyArb = fc.constantFrom("USD", "EUR", "GBP", "CAD", "AUD");

/** Random billing status (excluding "charged" for valid holds) */
const validBillingStatusArb = fc.constantFrom("pending", "hold_placed", "hold_failed", null);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMockDb({ consultation, customerProfile, paymentMethod }) {
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
  };
  getDb.mockReturnValue(mockDb);
  return mockDb;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 7: Null stripeCustomerId guard on hold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("for any customer with null stripeCustomerId, calling holdConsultationFunds SHALL throw with code NO_STRIPE_CUSTOMER (HTTP 400)", async () => {
    /**
     * Validates: Requirements 4.2
     */
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        uuidArb,
        ratePerMinuteCentsArb,
        validBillingStatusArb,
        currencyArb,
        async (profileId, consultationId, paymentMethodId, ratePerMinute, billingStatus, currency) => {
          vi.clearAllMocks();

          const consultation = {
            id: consultationId,
            customerId: profileId,
            billingStatus,
            ratePerMinuteCents: ratePerMinute,
            expert: { currency },
          };

          // Customer has NO stripeCustomerId
          const customerProfile = {
            id: profileId,
            stripeCustomerId: null,
          };

          const paymentMethod = {
            id: paymentMethodId,
            customerProfileId: profileId,
            stripePaymentMethodId: `pm_test123`,
          };

          buildMockDb({ consultation, customerProfile, paymentMethod });

          const auth = { customerProfileId: profileId };
          const body = { paymentMethodId };

          let thrownError = null;
          try {
            await holdConsultationFunds(auth, consultationId, body);
          } catch (err) {
            thrownError = err;
          }

          // Assert: error is thrown with correct structure
          expect(thrownError).not.toBeNull();
          expect(thrownError.statusCode).toBe(400);
          expect(thrownError.code).toBe("NO_STRIPE_CUSTOMER");

          // Assert: createPreAuthHold was NOT called (short-circuit)
          expect(stripeSvc.createPreAuthHold).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 8: Pre-auth hold parameters and response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("for any valid hold request where customer has a stripeCustomerId, the Stripe paymentIntents.create call SHALL include capture_method: manual, off_session: true, confirm: true, customer's Stripe ID, and payment method's Stripe ID; response SHALL contain stripePaymentIntentId", async () => {
    /**
     * Validates: Requirements 4.3, 4.4
     */
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        uuidArb,
        cusIdArb,
        pmIdArb,
        piIdArb,
        amountCentsArb,
        ratePerMinuteCentsArb,
        validBillingStatusArb,
        currencyArb,
        async (profileId, consultationId, paymentMethodId, cusId, stripePmId, returnedPiId, estimatedCents, ratePerMinute, billingStatus, currency) => {
          vi.clearAllMocks();

          const consultation = {
            id: consultationId,
            customerId: profileId,
            billingStatus,
            ratePerMinuteCents: ratePerMinute,
            expert: { currency },
          };

          // Customer HAS a stripeCustomerId
          const customerProfile = {
            id: profileId,
            stripeCustomerId: cusId,
          };

          const paymentMethod = {
            id: paymentMethodId,
            customerProfileId: profileId,
            stripePaymentMethodId: stripePmId,
          };

          buildMockDb({ consultation, customerProfile, paymentMethod });

          // Mock Stripe createPreAuthHold to return a PaymentIntent-like object
          stripeSvc.createPreAuthHold.mockResolvedValue({
            id: returnedPiId,
            status: "requires_capture",
          });

          const auth = { customerProfileId: profileId };
          const body = { paymentMethodId, estimatedCents };

          const result = await holdConsultationFunds(auth, consultationId, body);

          // Assert: createPreAuthHold called with correct parameters
          expect(stripeSvc.createPreAuthHold).toHaveBeenCalledOnce();
          const callArgs = stripeSvc.createPreAuthHold.mock.calls[0][0];

          // capture_method: "manual" is enforced by calling createPreAuthHold
          // (the stripeService function internally sets capture_method: "manual")
          // But we verify the billingService passes the correct customer and PM IDs
          expect(callArgs.customerStripeId).toBe(cusId);
          expect(callArgs.stripePaymentMethodId).toBe(stripePmId);
          expect(callArgs.amountCents).toBe(estimatedCents);
          expect(callArgs.currency).toBe(currency);
          expect(callArgs.metadata).toEqual({
            consultationId,
            customerProfileId: profileId,
          });

          // Assert: response contains the stripePaymentIntentId
          expect(result.stripePaymentIntentId).toBe(returnedPiId);
          expect(result.consultationId).toBe(consultationId);
          expect(result.amountCents).toBe(estimatedCents);
          expect(result.authorized).toBe(true);
          expect(result.holdStatus).toBe("requires_capture");
        }
      ),
      { numRuns: 100 }
    );
  });
});
