/**
 * Property 1: Stripe unavailability guard
 *
 * For any payment endpoint call when STRIPE_SECRET_KEY is absent,
 * response is HTTP 503 with STRIPE_UNAVAILABLE.
 *
 * Validates: Requirements 1.2
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { stripeGuard } from "../../middleware/stripeGuard.js";

/**
 * The three payment endpoints protected by stripeGuard.
 * We randomize which one is being "hit" via path/method in the request object.
 */
const PAYMENT_ENDPOINTS = [
  { method: "POST", path: "/api/v1/billing/payment-methods" },
  { method: "POST", path: "/api/v1/billing/consultations/:id/hold" },
  { method: "POST", path: "/api/v1/billing/consultations/:id/pay" },
];

/**
 * Arbitrary that generates an invalid STRIPE_SECRET_KEY value:
 * - undefined (key not set)
 * - empty string
 * - whitespace-only string
 * - string containing "placeholder"
 */
const invalidKeyArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(""),
  fc.constant("   "),
  fc.constant("  \t\n  "),
  fc.stringMatching(/^[a-z_]*placeholder[a-z_]*$/),
  fc.constant("sk_test_placeholder"),
  fc.constant("placeholder_key_123")
);

/**
 * Arbitrary that selects a random payment endpoint from the protected set.
 */
const endpointArb = fc.constantFrom(...PAYMENT_ENDPOINTS);

/**
 * Arbitrary that generates a random consultation UUID for parameterized routes.
 */
const consultationIdArb = fc.uuid();

describe("Property 1: Stripe unavailability guard", () => {
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("for any payment endpoint call when STRIPE_SECRET_KEY is absent or invalid, response is HTTP 503 with STRIPE_UNAVAILABLE", () => {
    /**
     * Validates: Requirements 1.2
     */
    fc.assert(
      fc.property(
        invalidKeyArb,
        endpointArb,
        consultationIdArb,
        (invalidKey, endpoint, consultationId) => {
          // Set up the environment
          if (invalidKey === undefined) {
            delete process.env.STRIPE_SECRET_KEY;
          } else {
            process.env.STRIPE_SECRET_KEY = invalidKey;
          }

          // Build request object simulating the selected endpoint
          const resolvedPath = endpoint.path.replace(":id", consultationId);
          const req = {
            method: endpoint.method,
            path: resolvedPath,
            headers: {},
            body: {},
          };

          // Build response mock
          let statusCode = null;
          let jsonBody = null;
          const res = {
            status(code) {
              statusCode = code;
              return this;
            },
            json(body) {
              jsonBody = body;
              return this;
            },
          };

          const next = vi.fn();

          // Execute the guard
          stripeGuard(req, res, next);

          // Assert: always 503 with STRIPE_UNAVAILABLE
          expect(statusCode).toBe(503);
          expect(jsonBody).toEqual({
            success: false,
            error: {
              code: "STRIPE_UNAVAILABLE",
              message: "Stripe integration is not configured",
            },
          });
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any payment endpoint call when STRIPE_SECRET_KEY is a valid key, the guard passes through", () => {
    /**
     * Counter-property: valid keys allow requests through.
     * This ensures the guard only blocks when the key is truly invalid.
     * Validates: Requirements 1.2 (inverse)
     */
    const validKeyArb = fc
      .stringMatching(/^sk_test_[a-zA-Z0-9]{10,40}$/)
      .filter((k) => !k.includes("placeholder"));

    fc.assert(
      fc.property(validKeyArb, endpointArb, (validKey, endpoint) => {
        process.env.STRIPE_SECRET_KEY = validKey;

        const req = {
          method: endpoint.method,
          path: endpoint.path,
          headers: {},
          body: {},
        };

        let statusCode = null;
        const res = {
          status(code) {
            statusCode = code;
            return this;
          },
          json() {
            return this;
          },
        };

        const next = vi.fn();

        stripeGuard(req, res, next);

        // Assert: next() is called, no 503 response
        expect(next).toHaveBeenCalledOnce();
        expect(statusCode).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
