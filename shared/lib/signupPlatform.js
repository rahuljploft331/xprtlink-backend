import { getDb } from "../db/getClient.js";

// shortcut: only profiles created this recently get tagged, so experts who signed up
// before tracking (or long ago) stay Unknown instead of a guess. Widen if app users
// register their push token later than this after signup.
const JUST_CREATED_MS = 24 * 60 * 60 * 1000;

/** The website runs in a browser; the Flutter app sends a Dart user agent. */
export function platformFromUserAgent(userAgent) {
  const ua = String(userAgent || "");
  return /Mozilla\//.test(ua) && !/Dart\//.test(ua) ? "web" : null;
}

/**
 * The app may send `X-Client-Platform: ios|android`; only those two are trusted
 * from the header (web is always detected from the browser user agent).
 */
export function platformFromRequest(headers = {}) {
  const declared = String(headers["x-client-platform"] || "").trim().toLowerCase();
  if (declared === "ios" || declared === "android") return declared;
  return platformFromUserAgent(headers["user-agent"]);
}

/** First write wins: never overwrites a known platform. Best-effort, never throws. */
export async function tagExpertSignupPlatform(userId, platform, now = new Date()) {
  if (!userId || !["ios", "android", "web"].includes(platform)) return;
  try {
    await getDb().expertProfile.updateMany({
      where: { userId, signupPlatform: null, createdAt: { gte: new Date(now.getTime() - JUST_CREATED_MS) } },
      data: { signupPlatform: platform },
    });
  } catch {
    // Tagging must never break login/signup or device registration.
  }
}
