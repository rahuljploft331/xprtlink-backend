import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { google } from "googleapis";

function getGoogleClient() {
  const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccount) {
    throw new Error("Google Service Account JSON is not configured in env");
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
    if (!purchaseToken || !subscriptionId) throw badRequest("Missing purchaseToken or subscriptionId");

    const db = getDb();
    
    // Find the requested plan
    let plan = await db.subscriptionPlan.findFirst({
      where: { code: planCode, isActive: true },
    });
    if (!plan) throw notFound("Subscription plan not found");

    const androidPublisher = getGoogleClient();
    const packageName = process.env.GOOGLE_PACKAGE_NAME;

    // Verify the subscription with Google
    const response = await androidPublisher.purchases.subscriptions.get({
      packageName,
      subscriptionId, // The product ID (e.g. core_monthly)
      token: purchaseToken,
    });

    const purchase = response.data;
    if (!purchase || !purchase.expiryTimeMillis) {
      throw badRequest("Invalid Google Play transaction");
    }
    
    const externalSubscriptionId = purchase.orderId || purchaseToken;
    const now = new Date();
    const periodEnd = new Date(parseInt(purchase.expiryTimeMillis, 10));

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
      console.error(`[googleIapController] Notification dispatch failed: ${err.message}`);
    }

    res.status(200).json({ success: true, message: "Google Play subscription verified successfully", data: subscription });
  } catch (error) {
    next(error);
  }
};
