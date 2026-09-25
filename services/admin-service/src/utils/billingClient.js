import { internalGet, internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { AppError, badRequest } from "@xprtlink/shared/utils/errors.js";

/**
 * admin-service has no Stripe client — money actions (payouts, refunds) run in
 * billing-service behind its internal endpoints. Re-throw billing's own 4xx
 * reason (e.g. "Stripe still needs: individual.phone") so the portal can show
 * it; anything else becomes a 502.
 */
const billingUrl = () => process.env.BILLING_SERVICE_URL ?? "http://localhost:4006";

function toAppError(err) {
  if (err?.statusCode >= 400 && err.statusCode < 500) {
    return new AppError(err.downstreamMessage ?? err.message, { statusCode: err.statusCode, code: err.code });
  }
  return new AppError(err?.downstreamMessage ?? err?.message ?? "Billing service unavailable", {
    statusCode: 502,
    code: err?.code ?? "BILLING_UNAVAILABLE",
  });
}

export async function billingGet(path) {
  try {
    return await internalGet(billingUrl(), `/api/v1/billing${path}`);
  } catch (err) {
    throw toAppError(err);
  }
}

export async function billingPost(path, body = {}) {
  try {
    return await internalPost(billingUrl(), `/api/v1/billing${path}`, body);
  } catch (err) {
    throw toAppError(err);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Route params are interpolated into billing URLs that carry the internal
 * service secret — reject anything but a UUID so a crafted value (e.g. an
 * encoded "../") can never reach a different internal endpoint.
 */
export function assertUuid(value, field = "id") {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw badRequest("invalidId", "INVALID_UUID", field);
  }
  return value;
}
