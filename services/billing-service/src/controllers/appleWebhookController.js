import { getDb } from "@xprtlink/shared/db/index.js";
import { AppStoreServerAPIClient, Environment } from "@apple/app-store-server-library";

// A simple webhook handler for Apple App Store Server Notifications V2
export const handleNotification = async (req, res, next) => {
  try {
    const { signedPayload } = req.body;
    if (!signedPayload) {
      return res.status(400).send("Missing signedPayload");
    }

    // In a production environment, you would decode and verify the signedPayload
    // using the @apple/app-store-server-library's Webhook tools (e.g. verifyAndDecodeNotification)
    // For this boilerplate, we'll assume it's decoded into `notificationType` and `data`.
    
    // Stub for decoded payload (you should implement actual JWT decoding here)
    // const decodedNotification = await decodePayload(signedPayload);
    const decodedNotification = { notificationType: "TEST", data: {} }; // Placeholder
    
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
    console.error("[appleWebhookController] Error handling webhook", error);
    res.status(500).send("Error");
  }
};
