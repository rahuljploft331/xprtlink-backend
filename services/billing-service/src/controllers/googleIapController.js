import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { google } from "googleapis";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { logSubscriptionEvent } from "../services/subscriptionLog.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";
import { cancelSupersededSubscriptions } from "../services/billingService.js";
import { activateStoreSubscription } from "../services/subscriptionOwnership.js";
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

    // The plan comes from what Google says was bought (the Play base plan), never from the
    // client's selection — otherwise a user could pay for Core and claim Elite.
    const paidBasePlanId = lineItem.offerDetails?.basePlanId?.trim().toLowerCase() || null;
    let plan = paidBasePlanId
      ? await db.subscriptionPlan.findFirst({ where: { code: paidBasePlanId, isActive: true } })
      : null;
    if (!plan) {
      // Base plan id doesn't map to one of our plan codes: fall back to the client's code, but say so.
      log.warn({ paidBasePlanId, planCode }, "[googleIapController] Play base plan does not match a plan code — using client planCode");
      plan = await db.subscriptionPlan.findFirst({ where: { code: planCode, isActive: true } });
    } else if (planCode && planCode !== plan.code) {
      log.warn({ paidBasePlanId, planCode }, "[googleIapController] Client planCode differs from the plan Google billed — using Google's");
    }
    if (!plan) throw notFound("subscriptionPlanNotFound");

    const externalSubscriptionId = purchaseToken;
    const now = new Date();
    let periodEnd = new Date(lineItem.expiryTime);

    // In Google Play license testing, periods are accelerated to 5 minutes.
    // In development or when duration is accelerated (< 24h), grant the full 30-day period
    // so testers can test features without the subscription disappearing.
    const isAccelerated = (periodEnd.getTime() - now.getTime()) < 24 * 60 * 60 * 1000;
    if (isAccelerated || process.env.NODE_ENV !== "production") {
      periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    } else if (periodEnd.getTime() <= now.getTime()) {
      throw badRequest("subscriptionExpired");
    }

    // Ownership + plan-hierarchy checks run atomically inside activateStoreSubscription.
    // Snapshot any cross-store active subs BEFORE the transaction cancels them in the DB.
    const crossStoreRows = await db.expertSubscription.findMany({
      where: {
        expertProfileId: req.auth.expertProfileId,
        store: { not: "google" },
        status: "active",
        currentPeriodEnd: { gt: now },
      },
      select: { id: true, store: true, externalSubscriptionId: true, expertProfileId: true },
    });

    const subscription = await activateStoreSubscription(db, {
      store: "google",
      externalSubscriptionId,
      linkedExternalId: purchase.linkedPurchaseToken ?? null,
      plan,
      expertProfileId: req.auth.expertProfileId,
      now,
      periodEnd,
    });

    // Attempt to cancel superseded cross-store subscriptions at the store level.
    // Done after the transaction so a store API failure never rolls back activation.
    const supersededSubscriptions = crossStoreRows.length > 0
      ? await cancelSupersededSubscriptions(crossStoreRows)
      : [];

    logSubscriptionEvent("SUBSCRIBED", { store: "google", plan: subscription.plan?.code, expertProfileId: req.auth.expertProfileId, note: "Purchase verified and activated" });

    // Notify expert
    try {
      const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
      await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: [req.auth.userId],
        type: "subscription_activated",
        audience: "expert",
        title: "Subscription Activated",
        body: `Your ${subscription.plan.name} plan is now active via Google Play.`,
        data: { subscriptionId: subscription.id, planId: subscription.planId },
      });

      const userEmail = (await getDb().user.findUnique({ where: { id: req.auth.userId }, select: { email: true } }))?.email;
      if (userEmail) {
        const emailHtml = await renderEmailTemplate({
          title: "Subscription Activated",
          bodyHtml: `<p>Your ${subscription.plan.name} plan is now active via Google Play.</p>`,
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
      log.error(`[googleIapController] Notification dispatch failed: ${err.message}`);
    }

    res.status(200).json({
      success: true,
      message: getMessage("googlePlaySubscriptionVerified"),
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
