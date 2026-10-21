import { getDb } from "@xprtlink/shared/db/index.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { google } from "googleapis";
const log = logger.child({ module: "googlePlayWebhookController" });

// Google Play Real-Time Developer Notifications (RTDN) subscription notification types
// https://developer.android.com/google/play/billing/rtdn-reference
const RTDN = {
  RECOVERED: 1,
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  ON_HOLD: 5,
  IN_GRACE_PERIOD: 6,
  RESTARTED: 7,
  PRICE_CHANGE_CONFIRMED: 8,
  DEFERRED: 9,
  PAUSED: 10,
  PAUSE_SCHEDULE_CHANGED: 11,
  REVOKED: 12,
  EXPIRED: 13,
};

/**
 * Fetch live subscription state from Google Play Developer API.
 * Returns null if the call fails (caller should fall back to existing DB state).
 */
async function fetchPlaySubscription(purchaseToken) {
  const serviceAccount = process.env.SERVICE_ACCOUNT_JSON;
  if (!serviceAccount) {
    log.warn("[googlePlayWebhookController] SERVICE_ACCOUNT_JSON not set — cannot fetch live state");
    return null;
  }
  try {
    const credentials = JSON.parse(serviceAccount);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
    const androidPublisher = google.androidpublisher({ version: "v3", auth });
    const response = await androidPublisher.purchases.subscriptionsv2.get({
      packageName: process.env.GOOGLE_PACKAGE_NAME,
      token: purchaseToken,
    });
    return response.data ?? null;
  } catch (err) {
    log.error({ err: err.message }, "[googlePlayWebhookController] fetchPlaySubscription failed");
    return null;
  }
}

/**
 * Revoke search eligibility for an expert only when they have no remaining
 * active, grace_period, or on_hold subscription (another store may be active).
 */
async function maybeRevokeSearchEligibility(db, expertProfileId) {
  const stillActive = await db.expertSubscription.findFirst({
    where: {
      expertProfileId,
      status: { in: ["active", "grace_period", "on_hold"] },
    },
    select: { id: true },
  });
  if (!stillActive) {
    await db.expertProfile.update({
      where: { id: expertProfileId },
      data: { searchEligible: false },
    });
  }
}

/**
 * Pub/Sub push authenticity: when GOOGLE_PUBSUB_AUDIENCE is set, require the OIDC
 * bearer token Pub/Sub attaches (and, if GOOGLE_PUBSUB_SA_EMAIL is set, its signer).
 * Unset = legacy open endpoint (state is still re-fetched from the Play API).
 */
async function isAuthenticPubSubPush(req) {
  const audience = process.env.GOOGLE_PUBSUB_AUDIENCE;
  if (!audience) return true;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const ticket = await new google.auth.OAuth2().verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    const expected = process.env.GOOGLE_PUBSUB_SA_EMAIL;
    return !expected || (payload?.email === expected && payload?.email_verified === true);
  } catch (err) {
    log.warn({ err: err.message }, "[googlePlayWebhookController] Pub/Sub token verification failed");
    return false;
  }
}

// Google Play Real-Time Developer Notifications handler
export const handleNotification = async (req, res, next) => {
  try {
    if (!(await isAuthenticPubSubPush(req))) {
      return res.status(401).send("Unauthorized");
    }
    const { message } = req.body;
    if (!message || !message.data) {
      return res.status(400).send("Invalid Google Pub/Sub message");
    }

    const decodedData = Buffer.from(message.data, "base64").toString("utf-8");
    const developerNotification = JSON.parse(decodedData);

    const { subscriptionNotification } = developerNotification;
    if (!subscriptionNotification) {
      // Test notification — ACK immediately
      return res.status(200).send("OK");
    }

    const externalSubscriptionId = subscriptionNotification.purchaseToken;
    const notificationType = subscriptionNotification.notificationType;

    const db = getDb();
    const subscription = await db.expertSubscription.findFirst({
      where: { store: "google", externalSubscriptionId },
      include: { expert: true },
    });

    if (!subscription) {
      // Unknown token — still ACK so Pub/Sub doesn't retry indefinitely
      log.warn(
        { externalSubscriptionId, notificationType },
        "[googlePlayWebhookController] Received notification for unknown purchaseToken"
      );
      return res.status(200).send("OK");
    }

    log.info(
      { externalSubscriptionId, notificationType, expertProfileId: subscription.expertProfileId },
      "[googlePlayWebhookController] Processing RTDN notification"
    );

    switch (notificationType) {
      case RTDN.RENEWED:
      case RTDN.RECOVERED:
      case RTDN.RESTARTED:
      case RTDN.PURCHASED: {
        // Fetch the live expiry from Google Play to get the exact new period end.
        const purchase = await fetchPlaySubscription(externalSubscriptionId);
        let newPeriodEnd;
        if (purchase?.lineItems?.[0]?.expiryTime) {
          newPeriodEnd = new Date(purchase.lineItems[0].expiryTime);
          // In accelerated test environments, grant a full 30-day period
          const isAccelerated = (newPeriodEnd.getTime() - Date.now()) < 24 * 60 * 60 * 1000;
          if (isAccelerated || process.env.NODE_ENV !== "production") {
            newPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          }
        } else {
          // Fallback: extend from current period end
          newPeriodEnd = new Date(subscription.currentPeriodEnd);
          newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
          log.warn(
            { externalSubscriptionId },
            "[googlePlayWebhookController] Could not fetch live expiry from Play API — using fallback +1 month"
          );
        }

        await db.expertSubscription.update({
          where: { id: subscription.id },
          data: { lastVerifiedAt: new Date(),
            status: "active",
            currentPeriodEnd: newPeriodEnd,
            cancelAtPeriodEnd: false,
            gracePeriodEnd: null,
          },
        });

        // Restore search eligibility if it was previously revoked
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

      case RTDN.CANCELED: {
        // User disabled auto-renewal — access continues until the verified expiry.
        // Cancellation != expiration: status stays as-is. Confirm against the Play API.
        const live = await fetchPlaySubscription(externalSubscriptionId);
        const liveExpiry = live?.lineItems?.[0]?.expiryTime;
        await db.expertSubscription.update({
          where: { id: subscription.id },
          data: { lastVerifiedAt: new Date(),
            cancelAtPeriodEnd: true,
            ...(liveExpiry && process.env.NODE_ENV === "production"
              ? { currentPeriodEnd: new Date(liveExpiry) }
              : {}),
          },
        });
        break;
      }

      case RTDN.ON_HOLD: {
        // Billing failed — subscription is on hold, access revoked immediately.
        await db.expertSubscription.update({
          where: { id: subscription.id },
          data: { lastVerifiedAt: new Date(), status: "on_hold" },
        });
        await maybeRevokeSearchEligibility(db, subscription.expertProfileId);
        break;
      }

      case RTDN.IN_GRACE_PERIOD: {
        // Billing failed but within grace period — access granted, fetch grace end date.
        const purchase = await fetchPlaySubscription(externalSubscriptionId);
        const gracePeriodEnd = purchase?.lineItems?.[0]?.expiryTime
          ? new Date(purchase.lineItems[0].expiryTime)
          : null;

        await db.expertSubscription.update({
          where: { id: subscription.id },
          data: { lastVerifiedAt: new Date(),
            status: "grace_period",
            gracePeriodEnd: gracePeriodEnd,
          },
        });
        break;
      }

      case RTDN.REVOKED: {
        // Subscription refunded/revoked by Google — remove access immediately.
        await db.expertSubscription.update({
          where: { id: subscription.id },
          data: { lastVerifiedAt: new Date(), status: "canceled", canceledAt: new Date(), cancelAtPeriodEnd: false },
        });
        await maybeRevokeSearchEligibility(db, subscription.expertProfileId);
        break;
      }

      case RTDN.EXPIRED: {
        await db.expertSubscription.update({
          where: { id: subscription.id },
          data: { lastVerifiedAt: new Date(), status: "expired" },
        });
        await maybeRevokeSearchEligibility(db, subscription.expertProfileId);
        break;
      }

      case RTDN.PAUSED:
      case RTDN.PAUSE_SCHEDULE_CHANGED:
      case RTDN.DEFERRED:
      case RTDN.PRICE_CHANGE_CONFIRMED: {
        // Log but take no DB action — these don't change entitlement status
        log.info(
          { notificationType, externalSubscriptionId },
          "[googlePlayWebhookController] Informational RTDN — no action taken"
        );
        break;
      }

      default:
        log.warn(
          { notificationType, externalSubscriptionId },
          "[googlePlayWebhookController] Unknown RTDN notificationType — no action taken"
        );
    }

    // Google Pub/Sub expects a 200 OK to ACK the message
    res.status(200).send("OK");
  } catch (error) {
    log.error({ err: error }, "[googlePlayWebhookController] Error handling webhook");
    // Return 200 to prevent Pub/Sub from retrying a malformed/unrecoverable message.
    // For transient errors (DB unavailable) return 500 so Pub/Sub retries.
    if (error?.code === "P2002" || error?.statusCode >= 500) {
      return res.status(500).send("Error");
    }
    res.status(200).send("OK");
  }
};
