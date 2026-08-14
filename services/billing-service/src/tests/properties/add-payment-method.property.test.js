/**
 * Property tests for addPaymentMethod (Properties 3, 4, 5, 6)
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * Mock boundary: stripeService.js and @xprtlink/shared/db
 * Strategy: Generate random customer profiles, emails, pm_ IDs
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../services/stripeService.js", () => ({
  getOrCreateStripeCustomer: vi.fn(),
  attachPaymentMethod: vi.fn(),
}));

vi.mock("@xprtlink/shared/db", () => ({
  getDb: vi.fn(),
}));

vi.mock("@xprtlink/shared/mappers/billing.mapper.js", () => ({
  toPaymentMethodDto: vi.fn((m) => m),
}));

vi.mock("@xprtlink/shared/utils/errors.js", () => ({
  badRequest: vi.fn((msg, code) => ({ statusCode: 400, code, message: msg })),
  notFound: vi.fn((msg) => ({ statusCode: 404, message: msg })),
  conflict: vi.fn((msg) => ({ statusCode: 409, message: msg })),
  forbidden: vi.fn((msg) => ({ statusCode: 403, message: msg })),
}));

vi.mock("@xprtlink/shared/utils/pagination.js", () => ({
  parsePagination: vi.fn(),
  paginatedResult: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import * as stripeSvc from "../../services/stripeService.js";
import { getDb } from "@xprtlink/shared/db";
import { addPaymentMethod } from "../../services/billingService.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Random email addresses */
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{3,10}$/),
    fc.stringMatching(/^[a-z]{3,8}$/),
    fc.constantFrom("gmail.com", "yahoo.com", "outlook.com", "example.org")
  )
  .map(([user, suffix, domain]) => `${user}.${suffix}@${domain}`);

/** Random first/last names */
const nameArb = fc.stringMatching(/^[A-Z][a-z]{2,10}$/);

/** Random Stripe Payment Method IDs (pm_*) */
const pmIdArb = fc
  .stringMatching(/^[a-zA-Z0-9]{14,28}$/)
  .map((s) => `pm_${s}`);

/** Random Stripe Customer IDs (cus_*) */
const cusIdArb = fc
  .stringMatching(/^[a-zA-Z0-9]{14,28}$/)
  .map((s) => `cus_${s}`);

/** Random UUID for customer profile IDs */
const uuidArb = fc.uuid();

/** Random card brands */
const brandArb = fc.constantFrom("visa", "mastercard", "amex", "discover");

/** Random last4 digits */
const last4Arb = fc.stringMatching(/^[0-9]{4}$/);

/** Random expMonth (1-12) */
const expMonthArb = fc.integer({ min: 1, max: 12 });

/** Random expYear */
const expYearArb = fc.integer({ min: 2025, max: 2035 });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMockDb({ customerProfile, paymentMethodCount = 0 }) {
  const createdMethod = { id: "method-1", ...customerProfile };
  const mockDb = {
    customerProfile: {
      findUnique: vi.fn().mockResolvedValue(customerProfile),
      update: vi.fn().mockResolvedValue(customerProfile),
    },
    paymentMethod: {
      count: vi.fn().mockResolvedValue(paymentMethodCount),
      create: vi.fn().mockResolvedValue(createdMethod),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  getDb.mockReturnValue(mockDb);
  return mockDb;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 3: Stripe Customer creation and persistence on first payment method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("for any customer with null stripeCustomerId, addPaymentMethod SHALL create a Stripe Customer using email and full name, and persist the returned cus_* ID", async () => {
    /**
     * Validates: Requirements 3.1, 3.2
     */
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        emailArb,
        nameArb,
        nameArb,
        pmIdArb,
        cusIdArb,
        brandArb,
        last4Arb,
        expMonthArb,
        expYearArb,
        async (profileId, email, firstName, lastName, pmId, returnedCusId, brand, last4, expMonth, expYear) => {
          vi.clearAllMocks();

          const customerProfile = {
            id: profileId,
            stripeCustomerId: null,
            firstName,
            lastName,
            user: { email },
          };

          const mockDb = buildMockDb({ customerProfile });

          // Stripe returns a customer with the generated cus_ ID
          stripeSvc.getOrCreateStripeCustomer.mockResolvedValue({ id: returnedCusId });
          stripeSvc.attachPaymentMethod.mockResolvedValue({});

          const auth = { customerProfileId: profileId };
          const body = { stripePaymentMethodId: pmId, brand, last4, expMonth, expYear };

          await addPaymentMethod(auth, body);

          // Assert: getOrCreateStripeCustomer called with email and full name
          expect(stripeSvc.getOrCreateStripeCustomer).toHaveBeenCalledOnce();
          expect(stripeSvc.getOrCreateStripeCustomer).toHaveBeenCalledWith({
            email,
            name: `${firstName} ${lastName}`,
          });

          // Assert: stripeCustomerId persisted via db update
          expect(mockDb.customerProfile.update).toHaveBeenCalledOnce();
          expect(mockDb.customerProfile.update).toHaveBeenCalledWith({
            where: { id: profileId },
            data: { stripeCustomerId: returnedCusId },
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 4: Stripe Customer reuse on subsequent payment methods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("for any customer with already-populated stripeCustomerId, addPaymentMethod SHALL NOT call getOrCreateStripeCustomer", async () => {
    /**
     * Validates: Requirements 3.3
     */
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        emailArb,
        nameArb,
        nameArb,
        pmIdArb,
        cusIdArb,
        brandArb,
        last4Arb,
        expMonthArb,
        expYearArb,
        async (profileId, email, firstName, lastName, pmId, existingCusId, brand, last4, expMonth, expYear) => {
          vi.clearAllMocks();

          const customerProfile = {
            id: profileId,
            stripeCustomerId: existingCusId,
            firstName,
            lastName,
            user: { email },
          };

          buildMockDb({ customerProfile, paymentMethodCount: 1 });

          stripeSvc.attachPaymentMethod.mockResolvedValue({});

          const auth = { customerProfileId: profileId };
          const body = { stripePaymentMethodId: pmId, brand, last4, expMonth, expYear };

          await addPaymentMethod(auth, body);

          // Assert: getOrCreateStripeCustomer NOT called
          expect(stripeSvc.getOrCreateStripeCustomer).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 5: Payment method attachment to Stripe Customer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("for any successful addPaymentMethod call, stripe attachPaymentMethod SHALL be called with the provided stripePaymentMethodId and the customer's stripeCustomerId", async () => {
    /**
     * Validates: Requirements 3.4
     */
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        emailArb,
        nameArb,
        nameArb,
        pmIdArb,
        cusIdArb,
        fc.boolean(),
        brandArb,
        last4Arb,
        expMonthArb,
        expYearArb,
        async (profileId, email, firstName, lastName, pmId, cusId, hasExistingCustomer, brand, last4, expMonth, expYear) => {
          vi.clearAllMocks();

          const stripeCustomerId = hasExistingCustomer ? cusId : null;
          const returnedCusId = hasExistingCustomer ? cusId : `cus_new_${cusId.slice(4)}`;

          const customerProfile = {
            id: profileId,
            stripeCustomerId,
            firstName,
            lastName,
            user: { email },
          };

          buildMockDb({ customerProfile, paymentMethodCount: hasExistingCustomer ? 1 : 0 });

          stripeSvc.getOrCreateStripeCustomer.mockResolvedValue({ id: returnedCusId });
          stripeSvc.attachPaymentMethod.mockResolvedValue({});

          const auth = { customerProfileId: profileId };
          const body = { stripePaymentMethodId: pmId, brand, last4, expMonth, expYear };

          await addPaymentMethod(auth, body);

          // The expected stripeCustomerId used for attachment
          const expectedCusId = hasExistingCustomer ? cusId : returnedCusId;

          // Assert: attachPaymentMethod called with correct args
          expect(stripeSvc.attachPaymentMethod).toHaveBeenCalledOnce();
          expect(stripeSvc.attachPaymentMethod).toHaveBeenCalledWith({
            stripePaymentMethodId: pmId,
            stripeCustomerId: expectedCusId,
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 6: Stripe Customer creation failure propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("for any Stripe Customer creation error, the endpoint SHALL throw with statusCode 502 and code STRIPE_CUSTOMER_CREATION_FAILED", async () => {
    /**
     * Validates: Requirements 3.5
     */
    const errorMessageArb = fc.stringMatching(/^[A-Za-z0-9 _\-:.]{5,60}$/);

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        emailArb,
        nameArb,
        nameArb,
        pmIdArb,
        errorMessageArb,
        async (profileId, email, firstName, lastName, pmId, errorMessage) => {
          vi.clearAllMocks();

          const customerProfile = {
            id: profileId,
            stripeCustomerId: null,
            firstName,
            lastName,
            user: { email },
          };

          buildMockDb({ customerProfile });

          // Stripe customer creation fails
          stripeSvc.getOrCreateStripeCustomer.mockRejectedValue(new Error(errorMessage));

          const auth = { customerProfileId: profileId };
          const body = { stripePaymentMethodId: pmId, brand: "visa", last4: "4242", expMonth: 12, expYear: 2027 };

          let thrownError = null;
          try {
            await addPaymentMethod(auth, body);
          } catch (err) {
            thrownError = err;
          }

          // Assert: error is thrown with correct structure
          expect(thrownError).not.toBeNull();
          expect(thrownError.statusCode).toBe(502);
          expect(thrownError.code).toBe("STRIPE_CUSTOMER_CREATION_FAILED");
          expect(thrownError.message).toBe(errorMessage);

          // Assert: attachPaymentMethod was NOT called (short-circuit on error)
          expect(stripeSvc.attachPaymentMethod).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});
