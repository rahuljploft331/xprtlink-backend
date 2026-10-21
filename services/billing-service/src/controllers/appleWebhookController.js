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
        /**
         * Helper: revoke search eligibility only when no other active entitlement exists.
         * An expert who switched stores before Apple fired REVOKE would still have a
         * google/stripe active subscription — don't remove them from search.
         */
        const maybeRevokeSearch = async () => {
          const stillActive = await db.expertSubscription.findFirst({
            where: {
              expertProfileId: subscription.expertProfileId,
              status: { in: ["active", "grace_period", "on_hold"] },
            },
            select: { id: true },
          });
          if (!stillActive) {
            await db.expertProfile.update({
              where: { id: subscription.expertProfileId },
              data: { searchEligible: false },
            });
          }
        };

        // Every verified notification stamps lastVerifiedAt. Updates below are
        // absolute (not incremental), so duplicate/replayed notifications are idempotent.
        const origUpdate = db.expertSubscription.update.bind(db.expertSubscription);
        const verifiedAt = new Date();
        const update = (args) =>
          origUpdate({ ...args, data: { ...args.data, lastVerifiedAt: verifiedAt } });

        const isSandbox = data?.environment === "Sandbox" || process.env.NODE_ENV !== "production";

        switch (notificationType) {
          case "DID_RENEW": {
            let newPeriodEnd = transactionInfo?.expiresDate
              ? new Date(transactionInfo.expiresDate)
              : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            if (isSandbox) {
              newPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            }
            await update({
              where: { id: subscription.id },
              data: {
                currentPeriodEnd: newPeriodEnd,
                status: "active",
                cancelAtPeriodEnd: false,
                gracePeriodEnd: null,
              },
            });
            // Restore search eligibility if it had been revoked during a grace/hold period
            await db.expertProfile.updateMany({
              where: {
                id: subscription.expertProfileId,
                verificationStatus: "approved",
                searchEligible: false,
              },
              data: { searchEligible: true },
            });
            break;
          }

          case "DID_FAIL_TO_RENEW": {
            if (subtype === "GRACE_PERIOD") {
              // Billing failed but within grace period — expert retains access.
              // gracePeriodEnd comes from the transaction's expiresDate in this context.
              const gracePeriodEnd = transactionInfo?.expiresDate
                ? new Date(transactionInfo.expiresDate)
                : null;
              await update({
                where: { id: subscription.id },
                data: { status: "grace_period", gracePeriodEnd },
              });
            } else {
              // Billing retry exhausted without payment — subscription on hold.
              await update({
                where: { id: subscription.id },
                data: { status: "on_hold", gracePeriodEnd: null },
              });
              await maybeRevokeSearch();
            }
            break;
          }

          case "GRACE_PERIOD_EXPIRED": {
            // Grace period ended without payment — move to on_hold
            await update({
              where: { id: subscription.id },
              data: { status: "on_hold", gracePeriodEnd: null },
            });
            await maybeRevokeSearch();
            break;
          }

          case "EXPIRED": {
            if (!isSandbox || subscription.currentPeriodEnd <= new Date()) {
              await update({
                where: { id: subscription.id },
                data: { status: "expired" },
              });
              await maybeRevokeSearch();
            }
            break;
          }

          case "REFUND":
          case "REVOKE": {
            await update({
              where: { id: subscription.id },
              data: { status: "canceled", canceledAt: new Date(), cancelAtPeriodEnd: false },
            });
            await maybeRevokeSearch();
            break;
          }

          case "DID_CHANGE_RENEWAL_STATUS": {
            if (subtype === "AUTO_RENEW_DISABLED") {
              await update({
                where: { id: subscription.id },
                data: {
                  cancelAtPeriodEnd: true,
                  ...(transactionInfo?.expiresDate && !isSandbox
                    ? { currentPeriodEnd: new Date(transactionInfo.expiresDate) }
                    : {}),
                },
              });
            } else if (subtype === "AUTO_RENEW_ENABLED") {
              await update({
                where: { id: subscription.id },
                data: { cancelAtPeriodEnd: false },
              });
            }
            break;
          }

          default:
            log.info(
              { notificationType, subtype, externalSubscriptionId },
              "[appleWebhookController] Unhandled notification type — no action taken"
            );
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


