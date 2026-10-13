import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound, conflict } from "@xprtlink/shared/utils/errors.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";
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
      where: { code: targetProductCode, isActive: true },
    });
    if (!plan) throw notFound("subscriptionPlanNotFound");

    // 2. Check revocation & expiration
    if (decoded.revocationDate) {
      throw badRequest("subscriptionRevoked");
    }

    const now = new Date();
    const periodEnd = decoded.expiresDate ? new Date(decoded.expiresDate) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (decoded.expiresDate && periodEnd.getTime() <= now.getTime()) {
      throw badRequest("subscriptionExpired");
    }

    // 3. Prevent replay attacks / multiple accounts claiming same Apple ID subscription
    const externalSubscriptionId = decoded.originalTransactionId || transactionId;
    const existingSub = await db.expertSubscription.findFirst({
      where: {
        store: "apple",
        externalSubscriptionId,
        expertProfileId: { not: req.auth.expertProfileId },
      },
      include: { expert: { include: { user: true } } },
    });

    if (existingSub) {
      const isStillActive = existingSub.status === "active" && existingSub.currentPeriodEnd > now;

      if (isStillActive) {
        // In development / sandbox testing OR if client explicitly requests transfer
        const isDevOrSandbox = process.env.NODE_ENV !== "production";
        if (isDevOrSandbox || req.body.transfer === true) {
          log.info(
            {
              externalSubscriptionId,
              fromExpertId: existingSub.expertProfileId,
              toExpertId: req.auth.expertProfileId,
              isDevOrSandbox,
            },
            "[appleIapController] Transferring active subscription to new account"
          );
          await db.expertSubscription.update({
            where: { id: existingSub.id },
            data: { status: "canceled", canceledAt: now },
          });
        } else {
          throw conflict("subscriptionAlreadyLinkedToAnotherAccount", "SUBSCRIPTION_ALREADY_LINKED");
        }
      } else {
        // Previous owner's subscription has expired; mark as expired so new owner can claim cleanly
        await db.expertSubscription.update({
          where: { id: existingSub.id },
          data: { status: "expired" },
        });
      }
    }

    const subscription = await db.$transaction(async (tx) => {
      // Deactivate other active subscriptions for this expert
      await tx.expertSubscription.updateMany({
        where: {
          expertProfileId: req.auth.expertProfileId,
          status: "active",
          externalSubscriptionId: { not: externalSubscriptionId },
        },
        data: { status: "canceled", canceledAt: now, cancelAtPeriodEnd: false },
      });

      const created = await tx.expertSubscription.upsert({
        where: {
          store_externalSubscriptionId: {
            store: "apple",
            externalSubscriptionId,
          },
        },
        update: {
          expertProfileId: req.auth.expertProfileId,
          planId: plan.id,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          canceledAt: null,
        },
        create: {
          expertProfileId: req.auth.expertProfileId,
          planId: plan.id,
          store: "apple",
          externalSubscriptionId,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        include: { plan: true },
      });

      // Mark expert as discoverable in search
      await tx.expertProfile.updateMany({
        where: { id: req.auth.expertProfileId, verificationStatus: "approved", searchEligible: false },
        data: { searchEligible: true },
      });

      return created;
    });

    // Notify expert
    try {
      const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
      await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: [req.auth.userId],
        type: "subscription_activated",
        title: "Subscription Activated",
        body: `Your ${subscription.plan.name} plan is now active via Apple.`,
        data: { subscriptionId: subscription.id, planId: subscription.planId },
      });

      const userEmail = (await getDb().user.findUnique({ where: { id: req.auth.userId }, select: { email: true } }))?.email;
      if (userEmail) {
        const emailHtml = await renderEmailTemplate({
          title: "Subscription Activated",
          bodyHtml: `<p>Your ${subscription.plan.name} plan is now active via Apple.</p>`,
          ctaText: "View Subscription",
          ctaUrl: process.env.APP_DEEP_LINK_URL ?? "https://expert.xprtlink.com",
        });
        await sendEmail({
          to: userEmail,
          subject: "Subscription Activated",
          html: emailHtml,
        });
      }
    } catch (err) {
      log.error(`[appleIapController] Notification dispatch failed: ${err.message}`);
    }

    res.status(200).json({ success: true, message: getMessage("appleSubscriptionVerified"), data: subscription });
  } catch (error) {
    next(error);
  }
};
