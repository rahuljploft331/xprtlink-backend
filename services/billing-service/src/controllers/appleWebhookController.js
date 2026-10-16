import { getDb } from "@xprtlink/shared/db/index.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "appleWebhookController" });
import {
  SignedDataVerifier,
  Environment,
} from "@apple/app-store-server-library";

/**
 * Build a SignedDataVerifier for server-to-server notification payloads.
 * Same env vars as appleIapController: APPLE_BUNDLE_ID, APPLE_ROOT_CA_PEM, APPLE_APP_ID.
 */
function getAppleVerifier() {
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const appAppleId = process.env.APPLE_APP_ID ? Number(process.env.APPLE_APP_ID) : undefined;
  const environment = process.env.NODE_ENV === "production" ? Environment.PRODUCTION : Environment.SANDBOX;
  const enableOnlineChecks = process.env.NODE_ENV === "production";

  const rootCerts = [];
  if (process.env.APPLE_ROOT_CA_PEM) {
    for (const pem of process.env.APPLE_ROOT_CA_PEM.split(";")) {
      const trimmed = pem.trim();
      if (trimmed) rootCerts.push(Buffer.from(trimmed, "base64"));
    }
  }

  return new SignedDataVerifier(rootCerts, enableOnlineChecks, environment, bundleId, appAppleId);
}

// Apple App Store Server Notifications V2 handler
export const handleNotification = async (req, res, next) => {
  try {
    const { signedPayload } = req.body;
    if (!signedPayload) {
      return res.status(400).send("Missing signedPayload");
    }

    // Verify and decode the signed notification payload (JWS)
    const verifier = getAppleVerifier();
    const decodedNotification = await verifier.verifyAndDecodeNotification(signedPayload);

    const db = getDb();

    const { notificationType, subtype, data } = decodedNotification;
    
    let transactionInfo = null;
    if (data?.signedTransactionInfo) {
      try {
        transactionInfo = await verifier.verifyAndDecodeTransaction(data.signedTransactionInfo);
      } catch (err) {
        log.warn({ err: err.message }, "[appleWebhookController] Error decoding signedTransactionInfo");
      }
    }

    const externalSubscriptionId = transactionInfo?.originalTransactionId;

    if (externalSubscriptionId) {
      const subscription = await db.expertSubscription.findFirst({
        where: { store: "apple", externalSubscriptionId },
        include: { expert: true },
      });

      if (subscription) {
        if (notificationType === "DID_RENEW") {
          let newPeriodEnd = transactionInfo?.expiresDate
            ? new Date(transactionInfo.expiresDate)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          if (data?.environment === "Sandbox" || process.env.NODE_ENV !== "production") {
            newPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          }
          await db.expertSubscription.update({
            where: { id: subscription.id },
            data: { currentPeriodEnd: newPeriodEnd, status: "active", cancelAtPeriodEnd: false },
          });
        } else if (notificationType === "REVOKE") {
          await db.expertSubscription.update({
            where: { id: subscription.id },
            data: { status: "canceled" },
          });
          // Only revoke search eligibility when the expert has no other active subscription
          // (e.g. they may have already switched to a new store before Apple fired REVOKE).
          const stillActive = await db.expertSubscription.findFirst({
            where: { expertProfileId: subscription.expertProfileId, status: "active" },
            select: { id: true },
          });
          if (!stillActive) {
            await db.expertProfile.update({
              where: { id: subscription.expertProfileId },
              data: { searchEligible: false },
            });
          }
        } else if (notificationType === "DID_FAIL_TO_RENEW" || notificationType === "EXPIRED") {
          const isDevOrSandbox = data?.environment === "Sandbox" || process.env.NODE_ENV !== "production";
          if (!isDevOrSandbox || subscription.currentPeriodEnd <= new Date()) {
            await db.expertSubscription.update({
              where: { id: subscription.id },
              data: { status: "expired" },
            });
            const stillActive = await db.expertSubscription.findFirst({
              where: { expertProfileId: subscription.expertProfileId, status: "active" },
              select: { id: true },
            });
            if (!stillActive) {
              await db.expertProfile.update({
                where: { id: subscription.expertProfileId },
                data: { searchEligible: false },
              });
            }
          }
        } else if (notificationType === "DID_CHANGE_RENEWAL_STATUS") {
          if (subtype === "AUTO_RENEW_DISABLED") {
            await db.expertSubscription.update({
              where: { id: subscription.id },
              data: { cancelAtPeriodEnd: true },
            });
          } else if (subtype === "AUTO_RENEW_ENABLED") {
            await db.expertSubscription.update({
              where: { id: subscription.id },
              data: { cancelAtPeriodEnd: false },
            });
          }
        }
      }
    }

    // Apple expects a 200 OK
    res.status(200).send("OK");
  } catch (error) {
    log.error({ err: error }, "[appleWebhookController] Error handling webhook");
    res.status(500).send("Error");
  }
};


