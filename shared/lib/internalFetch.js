/**
 * internalFetch.js
 *
 * Lightweight helpers for service-to-service calls.
 * Uses the native fetch API (Node 18+).
 * All requests include the x-internal-service header so receiving services
 * can distinguish internal calls from public traffic.
 */

const INTERNAL_HEADER = { "x-internal-service": "true" };

/**
 * GET an internal service endpoint and return the parsed JSON body.
 *
 * @param {string} serviceUrl  Base URL of the target service, e.g. process.env.BILLING_SERVICE_URL
 * @param {string} path        Path including leading slash, e.g. "/api/v1/billing/consultations/123/charge"
 * @returns {Promise<any>}     The `data` field from the standard ResponseFormatter envelope
 */
export async function internalGet(serviceUrl, path) {
  const url = `${serviceUrl}${path}`;
  const res = await fetch(url, { headers: INTERNAL_HEADER });
  if (!res.ok) {
    throw new Error(
      `[internalFetch] GET ${url} failed: ${res.status} ${res.statusText}`
    );
  }
  const json = await res.json();
  // Unwrap the standard { success, data } envelope if present
  return json?.data ?? json;
}

/**
 * POST to an internal service endpoint.
 *
 * @param {string} serviceUrl  Base URL of the target service
 * @param {string} path        Path including leading slash
 * @param {object} body        JSON-serialisable request body
 * @returns {Promise<any>}     The `data` field from the standard ResponseFormatter envelope
 */
export async function internalPost(serviceUrl, path, body = {}) {
  const url = `${serviceUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...INTERNAL_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `[internalFetch] POST ${url} failed: ${res.status} ${res.statusText}`
    );
  }
  const json = await res.json();
  return json?.data ?? json;
}
