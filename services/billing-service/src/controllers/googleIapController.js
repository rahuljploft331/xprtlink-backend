import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound, conflict } from "@xprtlink/shared/utils/errors.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { google } from "googleapis";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";
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

    // Prevent cross-account claiming of active subscriptions
    const existingSub = await db.expertSubscription.findFirst({
      where: {
        store: "google",
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
            "[googleIapController] Transferring active subscription to new account"
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
            store: "google",
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

    res.status(200).json({ success: true, message: getMessage("googlePlaySubscriptionVerified"), data: subscription });
  } catch (error) {
    next(error);
  }
};
