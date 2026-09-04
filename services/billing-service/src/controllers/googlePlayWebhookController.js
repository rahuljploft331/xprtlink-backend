import { getDb } from "@xprtlink/shared/db/index.js";

// A simple webhook handler for Google Play Real-Time Developer Notifications (RTDN)
export const handleNotification = async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message || !message.data) {
      return res.status(400).send("Invalid Google Pub/Sub message");
    }

    const decodedData = Buffer.from(message.data, 'base64').toString('utf-8');
    const developerNotification = JSON.parse(decodedData);

    const { subscriptionNotification } = developerNotification;
    if (!subscriptionNotification) {
      // Could be a test notification, just ACK it
      return res.status(200).send("OK");
    }

    const externalSubscriptionId = subscriptionNotification.purchaseToken;
    const notificationType = subscriptionNotification.notificationType;
    
    // Notification Types for Google Play:
    // 2: SUBSCRIPTION_RENEWED
    // 3: SUBSCRIPTION_CANCELED
    // 13: SUBSCRIPTION_EXPIRED
    
    const db = getDb();
    
    const subscription = await db.expertSubscription.findFirst({
      where: { store: "google", externalSubscriptionId },
      include: { expert: true },
    });

    if (subscription) {
      if (notificationType === 2) { // RENEWED
        // Ideally, you'd call googleapis again here to fetch the exact new expiryTimeMillis
        // For now, we extend by 1 month conceptually
        const newPeriodEnd = new Date(subscription.currentPeriodEnd);
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
        
        await db.expertSubscription.update({
          where: { id: subscription.id },
          data: { currentPeriodEnd: newPeriodEnd, status: "active", cancelAtPeriodEnd: false },
        });
      } else if (notificationType === 3) { // CANCELED (User disabled auto-renew)
        await db.expertSubscription.update({
          where: { id: subscription.id },
          data: { cancelAtPeriodEnd: true },
        });
      } else if (notificationType === 13) { // EXPIRED
        await db.expertSubscription.update({
          where: { id: subscription.id },
          data: { status: "expired" },
        });
        // Remove search eligibility if expired
        await db.expertProfile.update({
          where: { id: subscription.expertProfileId },
          data: { searchEligible: false },
        });
      }
    }

    // Google Pub/Sub expects a 200 OK
    res.status(200).send("OK");
  } catch (error) {
    console.error("[googlePlayWebhookController] Error handling webhook", error);
    res.status(500).send("Error");
  }
};
