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
    const externalSubscriptionId = data?.signedTransactionInfo?.originalTransactionId;

    if (externalSubscriptionId) {
      const subscription = await db.expertSubscription.findFirst({
        where: { store: "apple", externalSubscriptionId },
        include: { expert: true },
      });

      if (subscription) {
        if (notificationType === "DID_RENEW") {
          const newPeriodEnd = new Date(data.signedTransactionInfo.expiresDate);
          await db.expertSubscription.update({
            where: { id: subscription.id },
            data: { currentPeriodEnd: newPeriodEnd, status: "active", cancelAtPeriodEnd: false },
          });
        } else if (notificationType === "DID_FAIL_TO_RENEW" || notificationType === "EXPIRED") {
          await db.expertSubscription.update({
            where: { id: subscription.id },
            data: { status: "expired" },
          });
          // Remove search eligibility if expired
          await db.expertProfile.update({
            where: { id: subscription.expertProfileId },
            data: { searchEligible: false },
          });
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


