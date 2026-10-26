import { AppError, badRequest } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logger as log } from "@xprtlink/shared/lib/logger.js";

/**
 * Place search for Service Areas, proxied to Google Places (New) so the Google key stays on the server
 * (clients - the website and, if it wants, the app - never hold it). Callers must be authenticated experts and are
 * rate limited per user in the routes.
 */
const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";
const TIMEOUT_MS = 5000;
const MAX_SUGGESTIONS = 5;

const SESSION_RE = /^[A-Za-z0-9-]{8,64}$/;
const PLACE_ID_RE = /^[A-Za-z0-9_-]{8,400}$/;

function apiKey() {
  const key = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!key) throw new AppError(getMessage("placesNotConfigured"), { statusCode: 503, code: "PLACES_NOT_CONFIGURED" });
  return key;
}

function upstreamError(status, detail) {
  // The key is never logged; Google's own status/message is enough to diagnose (e.g. REQUEST_DENIED, quota).
  log.error({ status, detail }, "[places] Google Places request failed");
  return new AppError(getMessage("placesUnavailable"), { statusCode: 502, code: "PLACES_UPSTREAM_ERROR" });
}

async function googleFetch(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw upstreamError(res.status, body?.error?.status || body?.error?.message || "");
    }
    return await res.json();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw upstreamError(0, err?.name === "AbortError" ? "timeout" : String(err?.message || err));
  } finally {
    clearTimeout(timer);
  }
}

function cleanSession(sessionToken) {
  if (sessionToken === undefined || sessionToken === "") return undefined;
  if (typeof sessionToken !== "string" || !SESSION_RE.test(sessionToken)) throw badRequest("placesRequestInvalid", "INVALID_SESSION_TOKEN", "sessionToken");
  return sessionToken;
}

/** Up to 5 suggestions for a free-text query (cities, regions and businesses). */
export async function autocompletePlaces({ q, sessionToken } = {}) {
  const input = typeof q === "string" ? q.trim() : "";
  if (input.length < 3 || input.length > 200) throw badRequest("placesQueryInvalid", "INVALID_QUERY", "q");
  const session = cleanSession(sessionToken);
  const key = apiKey();

  const json = await googleFetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ input, ...(session ? { sessionToken: session } : {}) }),
  });

  const seen = new Set();
  return (json.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({ placeId: p.placeId, name: String(p.text?.text || "").slice(0, 200) }))
    .filter((p) => p.placeId && p.name && !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()))
    .slice(0, MAX_SUGGESTIONS);
}

/** Coordinates of a place picked from the suggestions. */
export async function getPlaceLocation({ placeId, sessionToken } = {}) {
  if (typeof placeId !== "string" || !PLACE_ID_RE.test(placeId)) throw badRequest("placesRequestInvalid", "INVALID_PLACE_ID", "placeId");
  const session = cleanSession(sessionToken);
  const key = apiKey();

  const json = await googleFetch(`${DETAILS_URL}/${encodeURIComponent(placeId)}${session ? `?sessionToken=${encodeURIComponent(session)}` : ""}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "location" },
  });
  const loc = json.location;
  if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
    throw new AppError(getMessage("placesUnavailable"), { statusCode: 502, code: "PLACES_UPSTREAM_ERROR" });
  }
  return { lat: loc.latitude, lng: loc.longitude };
}
