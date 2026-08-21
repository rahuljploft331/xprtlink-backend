import { getMessage } from "@xprtlink/shared/utils/messages.js";

import { getSecretSync } from "@xprtlink/shared/config/secrets.js";

/**
 * Stripe Guard Middleware
 *
 * Rejects all requests with HTTP 503 when STRIPE_SECRET_KEY is missing,
 * empty, or contains "placeholder". This ensures payment endpoints fail
 * explicitly rather than silently returning fake data.
 */
export function stripeGuard(req, res, next) {
  const key = getSecretSync("STRIPE_SECRET_KEY");
  if (!key || key.trim() === "" || key.includes("placeholder")) {
    return res.status(503).json({
      success: false,
      error: {
        code: "STRIPE_UNAVAILABLE",
        message: getMessage("stripeIntegrationIsNotConfigured"),
      },
    });
  }
  next();
}
