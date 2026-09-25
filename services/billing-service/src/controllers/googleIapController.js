import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { google } from "googleapis";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
const log = logger.child({ module: "googleIapController" });

function getGoogleClient() {
  const serviceAccount = process.env.SERVICE_ACCOUNT_JSON;
  if (!serviceAccount) {
    throw new Error("Service Account JSON is not configured in env");
  }

  const credentials = JSON.parse(serviceAccount);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });

  return google.androidpublisher({ version: "v3", auth });
}

export const verifyPurchase = async (req, res, next) => {
  try {
    const { purchaseToken, subscriptionId, planCode } = req.body;
    if (!purchaseToken || !subscriptionId) throw badRequest("missingPurchaseTokenOrSubscriptionId");

    const db = getDb();
    
    // Find the requested plan
    let plan = await db.subscriptionPlan.findFirst({
      where: { code: planCode, isActive: true },
    });
    if (!plan) throw notFound("subscriptionPlanNotFound");

    // Verify the subscription with Google
    const androidPublisher = getGoogleClient();
    const packageName = process.env.GOOGLE_PACKAGE_NAME;

    const response = await androidPublisher.purchases.subscriptionsv2.get({
      packageName,
      token: purchaseToken,
    });

    const purchase = response.data;
    if (!purchase || !purchase.lineItems || purchase.lineItems.length === 0) {
      throw badRequest("invalidGooglePlayTransaction");
    }
    
    const lineItem = purchase.lineItems[0];
    if (!lineItem.expiryTime) {
      throw badRequest("invalidGooglePlayTransaction");
    }

    const externalSubscriptionId = purchaseToken;
    const now = new Date();
    const periodEnd = new Date(lineItem.expiryTime);

    const subscription = await db.$transaction(async (tx) => {
      // Deactivate old active subscriptions for this expert
      await tx.expertSubscription.updateMany({
        where: { expertProfileId: req.auth.expertProfileId, status: "active" },
        data: { status: "canceled", canceledAt: now, cancelAtPeriodEnd: false },
      });

      const created = await tx.expertSubscription.create({
        data: {
          expertProfileId: req.auth.expertProfileId,
          planId: plan.id,
          store: "google",
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
        body: `Your ${subscription.plan.name} plan is now active via Google Play.`,
        data: { subscriptionId: subscription.id, planId: subscription.planId },
      });
    } catch (err) {
      log.error(`[googleIapController] Notification dispatch failed: ${err.message}`);
    }

    res.status(200).json({ success: true, message: getMessage("googlePlaySubscriptionVerified"), data: subscription });
  } catch (error) {
    next(error);
  }
};
