import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { logSubscriptionEvent } from "../services/subscriptionLog.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";
import { cancelSupersededSubscriptions } from "../services/billingService.js";
import { activateStoreSubscription } from "../services/subscriptionOwnership.js";
const log = logger.child({ module: "appleIapController" });
// N5 fix: decodeSignedTransaction does NOT exist on @apple/app-store-server-library.
// Only import the symbols that the library actually exports.
// N3 fix: SignedDataVerifier is added so we verify the JWS signature before trusting any payload.
import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
} from "@apple/app-store-server-library";

function getAppleClient() {
  const issuerId = process.env.APPLE_ISSUER_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const environment = process.env.NODE_ENV === "production" ? Environment.PRODUCTION : Environment.SANDBOX;

  if (!issuerId || !keyId || !privateKey || !bundleId) {
    throw new Error("Apple App Store credentials are not fully configured in env");
  }
  return new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, environment);
}

/**
 * Build a SignedDataVerifier from env config.
 *
 * APPLE_ROOT_CA_PEM — optional base64-encoded Apple Root CA PEM.
 *   Supply in production; leave empty in sandbox (library uses bundled roots).
 * APPLE_APP_ID — numeric App Store Connect App ID (optional; omit if not set).
 * enableOnlineChecks — true in production (OCSP revocation); false in sandbox/dev.
 */
function getAppleVerifier() {
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const appAppleId = process.env.APPLE_APP_ID ? Number(process.env.APPLE_APP_ID) : undefined;
  const environment = process.env.NODE_ENV === "production" ? Environment.PRODUCTION : Environment.SANDBOX;
  const enableOnlineChecks = process.env.NODE_ENV === "production";

  const rootCerts = [];
  if (process.env.APPLE_ROOT_CA_PEM) {
    // Support semicolon-separated list of base64-encoded certs
    for (const pem of process.env.APPLE_ROOT_CA_PEM.split(";")) {
      const trimmed = pem.trim();
      if (trimmed) rootCerts.push(Buffer.from(trimmed, "base64"));
    }
  }

  return new SignedDataVerifier(rootCerts, enableOnlineChecks, environment, bundleId, appAppleId);
}

export const verifyPurchase = async (req, res, next) => {
  try {
    const { transactionId, planCode } = req.body;
    if (!transactionId) throw badRequest("missingTransactionId");

    const db = getDb();

    const client = getAppleClient();
    const transactionInfo = await client.getTransactionInfo(transactionId);

    if (!transactionInfo || !transactionInfo.signedTransactionInfo) {
      throw badRequest("invalidAppleTransaction");
    }

    // N3 fix: verify JWS signature before trusting any payload field.
    // verifyAndDecodeTransaction throws VerificationException on invalid signatures.
    const verifier = getAppleVerifier();
    const decoded = await verifier.verifyAndDecodeTransaction(transactionInfo.signedTransactionInfo);

    // 1. Resolve product ID from Apple's cryptographically verified transaction
    const targetProductCode = decoded.productId || planCode;
    let plan = await db.subscriptionPlan.findFirst({
      where: { OR: [{ storeProductId: targetProductCode }, { code: targetProductCode }], isActive: true },
    });
    if (!plan) throw notFound("subscriptionPlanNotFound");

    // 2. Check revocation & expiration
    if (decoded.revocationDate) {
      throw badRequest("subscriptionRevoked");
    }

    const now = new Date();
    let periodEnd = decoded.expiresDate ? new Date(decoded.expiresDate) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    // In Apple Sandbox testing, Apple accelerates 1 month into 3-5 minutes.
    // In sandbox or when duration is accelerated (< 24h), grant the full 30-day period
    // so testers and QA can test features without the subscription disappearing after a few minutes.
    const isSandboxOrAccelerated = decoded.environment === "Sandbox" || (periodEnd.getTime() - now.getTime()) < 24 * 60 * 60 * 1000;
    if (isSandboxOrAccelerated || process.env.NODE_ENV !== "production") {
      periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    } else if (decoded.expiresDate && periodEnd.getTime() <= now.getTime()) {
      throw badRequest("subscriptionExpired");
    }

    // Ownership + plan-hierarchy checks run atomically inside activateStoreSubscription.
    // Snapshot any cross-store active subs BEFORE the transaction cancels them in the DB.
    // We pass these to cancelSupersededSubscriptions after the transaction to attempt
    // store-side cancellation — preventing the expert from being billed by two stores.
    const crossStoreRows = await db.expertSubscription.findMany({
      where: {
        expertProfileId: req.auth.expertProfileId,
        store: { not: "apple" },
        status: "active",
        currentPeriodEnd: { gt: now },
      },
      select: { id: true, store: true, externalSubscriptionId: true, expertProfileId: true },
    });

    const externalSubscriptionId = decoded.originalTransactionId || transactionId;

    const subscription = await activateStoreSubscription(db, {
      store: "apple",
      externalSubscriptionId,
      linkedExternalId: null,
      plan,
      expertProfileId: req.auth.expertProfileId,
      now,
      periodEnd,
    });

    // Attempt to cancel superseded cross-store subscriptions at the store level.
    // Done after the transaction so a store API failure never rolls back activation.
    // Best-effort — errors are logged and surfaced to the client as a warning.
    const supersededSubscriptions = crossStoreRows.length > 0
      ? await cancelSupersededSubscriptions(crossStoreRows)
      : [];

    logSubscriptionEvent("SUBSCRIBED", { store: "apple", plan: subscription.plan?.code, expertProfileId: req.auth.expertProfileId, note: "Purchase verified and activated" });

    // Notify expert
    try {
      const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
      await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: [req.auth.userId],
        type: "subscription_activated",
        audience: "expert",
        title: "Subscription Activated",
        body: `Your ${subscription.plan.name} plan is now active via Apple.`,
        data: { subscriptionId: subscription.id, planId: subscription.planId },
      });

      const userEmail = (await getDb().user.findUnique({ where: { id: req.auth.userId }, select: { email: true } }))?.email;
      if (userEmail) {
        const emailHtml = await renderEmailTemplate({
          title: "Subscription Activated",
          bodyHtml: `<p>Your ${subscription.plan.name} plan is now active via Apple.</p>`,
        });
        await sendEmail({ category: "subscription",
          to: userEmail,
          subject: "Subscription Activated",
          html: emailHtml,
        });
      }
    } catch (err) {
      log.error(`[appleIapController] Notification dispatch failed: ${err.message}`);
    }

    res.status(200).json({
      success: true,
      message: getMessage("appleSubscriptionVerified"),
      data: {
        ...subscription,
        gateway: subscription.store,
        subscribedVia: subscription.store,
        supersededSubscriptions,
      },
    });
  } catch (error) {
    next(error);
  }
};
