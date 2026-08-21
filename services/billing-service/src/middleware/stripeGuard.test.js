import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stripeGuard } from "./stripeGuard.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


describe("stripeGuard middleware", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {};
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("returns 503 when STRIPE_SECRET_KEY is missing", () => {
    delete process.env.STRIPE_SECRET_KEY;

    stripeGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "STRIPE_UNAVAILABLE",
        message: getMessage("stripeIntegrationIsNotConfigured"),
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 503 when STRIPE_SECRET_KEY is empty string", () => {
    process.env.STRIPE_SECRET_KEY = "";

    stripeGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "STRIPE_UNAVAILABLE",
        message: getMessage("stripeIntegrationIsNotConfigured"),
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 when STRIPE_SECRET_KEY contains "placeholder"', () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_key";

    stripeGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "STRIPE_UNAVAILABLE",
        message: getMessage("stripeIntegrationIsNotConfigured"),
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when STRIPE_SECRET_KEY is a valid value", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123realkey";

    stripeGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
