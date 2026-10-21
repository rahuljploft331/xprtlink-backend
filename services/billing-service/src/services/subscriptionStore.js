import { google } from "googleapis";
import { AppStoreServerAPIClient, Environment, SignedDataVerifier } from "@apple/app-store-server-library";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "subscriptionStore" });

const APPLE_MANAGE_URL = "https://apps.apple.com/account/subscriptions";
const GOOGLE_PRODUCT_ID = process.env.GOOGLE_SUBSCRIPTION_PRODUCT_ID ?? "xprtlink_subscription";
const RECONCILE_STALE_MS = 5 * 60 * 1000;

/** Env override is used only if it is a real https URL (ignores typos like link text). */
function envUrl(name) {
  const v = process.env[name]?.trim();
  if (!v) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    log.warn(`[getManagementUrl] ${name} is not a valid https URL — using default`);
    return null;
  }
}

/**
 * Store-hosted page where the user must cancel auto-renewal. Null for stripe.
 * Overridable via SUBSCRIPTION_CANCEL_URL_IOS / SUBSCRIPTION_CANCEL_URL_ANDROID.
 */
export function getManagementUrl(store) {
  if (store === "apple") return envUrl("SUBSCRIPTION_CANCEL_URL_IOS") ?? APPLE_MANAGE_URL;
  if (store === "google") {
    const override = envUrl("SUBSCRIPTION_CANCEL_URL_ANDROID");
    if (override) return override;
    const pkg = process.env.GOOGLE_PACKAGE_NAME;
    return `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(GOOGLE_PRODUCT_ID)}${
      pkg ? `&package=${encodeURIComponent(pkg)}` : ""
    }`;
  }
  return null;
}

export function isStoreManaged(store) {
  return store === "apple" || store === "google";
}

/** Google Play: live state via Developer API → { cancelAtPeriodEnd, expiry, state } or null. */
export async function fetchGoogleState(purchaseToken) {
  const serviceAccount = process.env.SERVICE_ACCOUNT_JSON;
  if (!serviceAccount) return null;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(serviceAccount),
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
    const api = google.androidpublisher({ version: "v3", auth });
    const { data } = await api.purchases.subscriptionsv2.get({
      packageName: process.env.GOOGLE_PACKAGE_NAME,
      token: purchaseToken,
    });
    const line = data?.lineItems?.[0];
    if (!line) return null;
    return {
      state: data.subscriptionState, // SUBSCRIPTION_STATE_ACTIVE | _CANCELED | _IN_GRACE_PERIOD | _ON_HOLD | _EXPIRED ...
      expiry: line.expiryTime ? new Date(line.expiryTime) : null,
      // autoRenewingPlan is absent/false once the user cancels in Play.
      cancelAtPeriodEnd: !line.autoRenewingPlan?.autoRenewEnabled,
    };
  } catch (err) {
    log.error({ err: err.message }, "[fetchGoogleState] failed");
    return null;
  }
}

/** Apple: App Store Server API → { cancelAtPeriodEnd, expiry, status } or null. */
export async function fetchAppleState(originalTransactionId) {
  const { APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_BUNDLE_ID } = process.env;
  const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!APPLE_ISSUER_ID || !APPLE_KEY_ID || !privateKey || !APPLE_BUNDLE_ID) return null;
  try {
    const prod = process.env.NODE_ENV === "production";
    const env = prod ? Environment.PRODUCTION : Environment.SANDBOX;
    const client = new AppStoreServerAPIClient(privateKey, APPLE_KEY_ID, APPLE_ISSUER_ID, APPLE_BUNDLE_ID, env);
    const roots = (process.env.APPLE_ROOT_CA_PEM ?? "")
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => Buffer.from(p, "base64"));
    const appId = process.env.APPLE_APP_ID ? Number(process.env.APPLE_APP_ID) : undefined;
    const verifier = new SignedDataVerifier(roots, prod, env, APPLE_BUNDLE_ID, appId);

    const res = await client.getAllSubscriptionStatuses(originalTransactionId);
    const last = res?.data?.flatMap((g) => g.lastTransactions ?? []).find((t) => t.originalTransactionId === originalTransactionId);
    if (!last) return null;
    const renewal = last.signedRenewalInfo ? await verifier.verifyAndDecodeRenewalInfo(last.signedRenewalInfo) : null;
    const tx = last.signedTransactionInfo ? await verifier.verifyAndDecodeTransaction(last.signedTransactionInfo) : null;
    return {
      status: last.status, // 1 active, 2 expired, 3 billing retry, 4 grace, 5 revoked
      expiry: tx?.expiresDate ? new Date(tx.expiresDate) : null,
      cancelAtPeriodEnd: renewal ? renewal.autoRenewStatus === 0 : null,
    };
  } catch (err) {
    // Apple's APIException / VerificationException leave .message empty; detail is on these fields.
    log.error(
      {
        err: err.message || err.name,
        errName: err.name,
        httpStatusCode: err.httpStatusCode,
        apiError: err.apiError,
        errorMessage: err.errorMessage,
        verificationStatus: err.status,
        cause: err.cause?.message,
      },
      "[fetchAppleState] failed",
    );
    return null;
  }
}

/**
 * Pull verified store state for an Apple/Google subscription and persist it.
 * Best-effort: on any failure the stored (webhook-driven) state is returned unchanged.
 * Only renewal flag + verification time are written here; entitlement end/expiry
 * transitions stay with the webhooks and the expiry cron. In non-production the
 * period end is not touched (sandbox timelines are accelerated).
 */
export async function reconcileSubscription(db, sub, { force = false } = {}) {
  if (!isStoreManaged(sub.store)) return sub;
  const stale = !sub.lastVerifiedAt || Date.now() - new Date(sub.lastVerifiedAt).getTime() > RECONCILE_STALE_MS;
  if (!force && !stale) return sub;

  const live = sub.store === "apple"
    ? await fetchAppleState(sub.externalSubscriptionId)
    : await fetchGoogleState(sub.externalSubscriptionId);
  if (!live) return sub;

  const data = { lastVerifiedAt: new Date() };
  if (typeof live.cancelAtPeriodEnd === "boolean") data.cancelAtPeriodEnd = live.cancelAtPeriodEnd;
  if (live.expiry && process.env.NODE_ENV === "production") data.currentPeriodEnd = live.expiry;
  return db.expertSubscription.update({ where: { id: sub.id }, data, include: { plan: true } });
}

/**
 * Push the expert when a VERIFIED store event turned auto-renew off, so an open
 * app refreshes GET /subscriptions/me and hides its Cancel button. Best-effort;
 * callers only invoke it on a real false->true transition (duplicates are silent).
 */
export async function notifyAutoRenewDisabled(sub, userId) {
  try {
    const when = sub.currentPeriodEnd
      ? new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "the end of your billing period";
    await internalPost(process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007", "/api/v1/notifications/dispatch", {
      userIds: [userId],
      type: "subscription_cancelled",
      title: "Subscription Cancellation Confirmed",
      body: `Auto-renewal is off. You keep access until ${when}.`,
      data: { subscriptionId: sub.id, planId: sub.planId, event: "subscription_status_changed" },
    });
  } catch (err) {
    log.warn({ err: err.message }, "[notifyAutoRenewDisabled] dispatch failed");
  }
}
