/**
 * Masks secrets in a request URL's query string before it is logged.
 *
 * Some endpoints must take a credential in the URL because the client cannot send headers - e.g. the admin portal's
 * live-update stream (EventSource) sends `?token=<JWT>` (see shared/middleware/auth.js). Log lines include the URL, so
 * without this a usable login token ends up in the PM2 and app log files. Only the value is replaced; everything else
 * (path, other params, original encoding) is kept so the log line stays useful.
 */
const SENSITIVE_PARAMS = new Set([
  "token",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "id_token",
  "idtoken",
  "password",
  "otp",
  "secret",
  "api_key",
  "apikey",
  "key",
  "code",
]);

export function redactUrl(url) {
  if (typeof url !== "string") return url;
  const q = url.indexOf("?");
  if (q === -1) return url;
  const hash = url.indexOf("#", q);
  const end = hash === -1 ? url.length : hash;

  const redacted = url
    .slice(q + 1, end)
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const rawName = pair.slice(0, eq);
      let name = rawName;
      try { name = decodeURIComponent(rawName); } catch { /* keep the raw name */ }
      return SENSITIVE_PARAMS.has(name.toLowerCase()) ? `${rawName}=[REDACTED]` : pair;
    })
    .join("&");

  return url.slice(0, q + 1) + redacted + url.slice(end);
}
