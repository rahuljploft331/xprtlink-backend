import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { AppStoreServerAPIClient, Environment, decodeSignedTransaction } from "@apple/app-store-server-library";

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

export const verifyPurchase = async (req, res, next) => {
  try {
    const { transactionId, planCode } = req.body;
    if (!transactionId) throw badRequest("Missing transactionId");

    const db = getDb();
    
    // Find the requested plan
    let plan = await db.subscriptionPlan.findFirst({
      where: { code: planCode, isActive: true },
    });
    if (!plan) throw notFound("Subscription plan not found");

    const client = getAppleClient();
    const transactionInfo = await client.getTransactionInfo(transactionId);
    
    if (!transactionInfo || !transactionInfo.signedTransactionInfo) {
      throw badRequest("Invalid Apple transaction");
    }

    const decoded = await decodeSignedTransaction(transactionInfo.signedTransactionInfo);
    
    // 1. Verify the product ID matches the selected plan
    if (decoded.productId !== plan.code) {
      throw badRequest("Transaction product ID does not match the requested plan");
    }

    // 2. Prevent replay attacks (has someone else already claimed this?)
    const externalSubscriptionId = decoded.originalTransactionId || transactionId;
    const existingSub = await db.expertSubscription.findFirst({
      where: { externalSubscriptionId, expertProfileId: { not: req.auth.expertProfileId } }
    });
    if (existingSub) {
      throw badRequest("This transaction has already been claimed by another account");
    }
    
    const now = new Date();
    // 3. Use the actual expiration date from Apple
    const periodEnd = decoded.expiresDate ? new Date(decoded.expiresDate) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

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
    } catch (err) {
      console.error(`[appleIapController] Notification dispatch failed: ${err.message}`);
    }

    res.status(200).json({ success: true, message: "Apple subscription verified successfully", data: subscription });
  } catch (error) {
    next(error);
  }
};
