import { getDb } from "@xprtlink/shared/db/index.js";
import { notifyAutoRenewDisabled } from "../services/subscriptionStore.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { logSubscriptionEvent } from "../services/subscriptionLog.js";
import { hasActiveEntitlement } from "../services/subscriptionRules.js";
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

    // Renewal info carries autoRenewProductId — the product that will renew next
    // period. It is the only place a scheduled (deferred) plan change shows up.
    let renewalInfo = null;
    if (data?.signedRenewalInfo) {
      try {
        renewalInfo = await verifier.verifyAndDecodeRenewalInfo(data.signedRenewalInfo);
      } catch (err) {
        log.warn({ err: err.message }, "[appleWebhookController] Error decoding signedRenewalInfo");
      }
    }

    const externalSubscriptionId = transactionInfo?.originalTransactionId;

    if (externalSubscriptionId) {
      const subscription = await db.expertSubscription.findFirst({
        where: { store: "apple", externalSubscriptionId },
        include: { expert: true, plan: true },
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

        const planCode = subscription.plan?.code;

        /**
         * The product Apple just billed is the source of truth for which plan the
         * row should hold — a downgrade that took effect at renewal arrives as a
         * DID_RENEW carrying the *new*, cheaper productId. Returns {} when the
         * product is unknown or unchanged, so the caller never nulls a good planId.
         */
        const planPatchFor = async (productId) => {
          if (!productId || productId === planCode) return {};
          const next = await db.subscriptionPlan.findFirst({ where: { code: productId, isActive: true } });
          if (!next) {
            log.warn({ productId, currentPlan: planCode }, "[appleWebhookController] Unknown productId — keeping current plan");
            return {};
          }
          log.info({ from: planCode, to: next.code, notificationType }, "[appleWebhookController] Plan changed by store event");
          return { planId: next.id };
        };
        const note = {
          SUBSCRIBED: ["SUBSCRIBED", "Apple confirmed a new or resumed subscription"],
          DID_RENEW: ["RENEWED", "Apple charged the renewal; period extended"],
          EXPIRED: ["EXPIRED", "Apple says the subscription ended"],
          GRACE_PERIOD_EXPIRED: ["EXPIRED", "Grace period ended without payment"],
          REFUND: ["REVOKED", "Apple refunded the purchase"],
          REVOKE: ["REVOKED", "Apple revoked access"],
          DID_FAIL_TO_RENEW: ["PAYMENT_FAILED", "Renewal payment failed"],
        }[notificationType];
        if (note) logSubscriptionEvent(note[0], { store: "apple", plan: planCode, expertProfileId: subscription.expertProfileId, note: `${note[1]} (Apple: ${notificationType}${subtype ? "/" + subtype : ""})` });
        if (notificationType === "DID_CHANGE_RENEWAL_STATUS") {
          logSubscriptionEvent(subtype === "AUTO_RENEW_DISABLED" ? "CANCELLED" : "RESUMED", {
            store: "apple", plan: planCode, expertProfileId: subscription.expertProfileId,
            note: subtype === "AUTO_RENEW_DISABLED" ? "User turned auto-renew off; access continues until period end" : "User turned auto-renew back on",
          });
        }

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
                // A downgrade scheduled earlier lands here: Apple renews on the new
                // product, so the row has to follow or the expert keeps the old tier.
                ...(await planPatchFor(transactionInfo?.productId)),
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

          /**
           * SUBSCRIBED/RESUBSCRIBE — the Apple ID bought this chain again after it
           * lapsed; SUBSCRIBED/INITIAL_BUY can also arrive for a chain we already hold.
           *
           * The purchase carries no appAccountToken, so a resubscribe cannot be
           * attributed to the account that made it. We therefore only refresh a row
           * that is STILL entitled — whose owner is unambiguous. A lapsed row is left
           * alone so the authenticated verify call decides who the new owner is;
           * reactivating it here would silently hand a stranger's purchase back to the
           * previous owner and then block the buyer with ALREADY_LINKED.
           */
          case "SUBSCRIBED": {
            if (!hasActiveEntitlement(subscription, new Date())) {
              log.info(
                { notificationType, subtype, externalSubscriptionId, expertProfileId: subscription.expertProfileId },
                "[appleWebhookController] SUBSCRIBED for a lapsed subscription — left for verify to attribute"
              );
              break;
            }

            // A resubscribe may land on a different tier than the row currently holds.
            const planPatch = await planPatchFor(transactionInfo?.productId);

            let newPeriodEnd = transactionInfo?.expiresDate
              ? new Date(transactionInfo.expiresDate)
              : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            if (isSandbox) {
              newPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            }

            await update({
              where: { id: subscription.id },
              data: {
                ...planPatch,
                currentPeriodEnd: newPeriodEnd,
                status: "active",
                cancelAtPeriodEnd: false,
                gracePeriodEnd: null,
                canceledAt: null,
              },
            });
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

          /**
           * The subscriber picked a different product in the same group.
           *
           * Apple ranks products by Subscription Level in App Store Connect, not by
           * price, and the subtype reflects that ranking:
           *   UPGRADE   — effective immediately, Apple also bills a new transaction
           *   DOWNGRADE — deferred to the next renewal; nothing changes yet, and the
           *               DID_RENEW above applies it when Apple bills the new product
           *   (none)    — the subscriber reverted a pending downgrade
           */
          case "DID_CHANGE_RENEWAL_PREF": {
            const autoRenewProductId = renewalInfo?.autoRenewProductId ?? null;
            log.info(
              { subtype: subtype ?? null, currentPlan: planCode, autoRenewProductId, productId: transactionInfo?.productId, externalSubscriptionId },
              "[appleWebhookController] Renewal preference changed"
            );

            if (subtype === "UPGRADE") {
              let newPeriodEnd = transactionInfo?.expiresDate
                ? new Date(transactionInfo.expiresDate)
                : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
              if (isSandbox) {
                newPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
              }
              await update({
                where: { id: subscription.id },
                data: {
                  ...(await planPatchFor(transactionInfo?.productId)),
                  currentPeriodEnd: newPeriodEnd,
                  status: "active",
                  cancelAtPeriodEnd: false,
                  gracePeriodEnd: null,
                  canceledAt: null,
                },
              });
              logSubscriptionEvent("UPGRADED", {
                store: "apple", plan: autoRenewProductId ?? planCode, expertProfileId: subscription.expertProfileId,
                note: `Switched to a higher App Store level; effective immediately (Apple: ${notificationType}/UPGRADE)`,
              });
              break;
            }

            // DOWNGRADE and the revert case are both deferred: record only. Touching
            // planId here would strip paid access the subscriber still owns.
            await update({ where: { id: subscription.id }, data: {} });
            logSubscriptionEvent(subtype === "DOWNGRADE" ? "DOWNGRADE_SCHEDULED" : "RENEWAL_PREF_REVERTED", {
              store: "apple", plan: planCode, expertProfileId: subscription.expertProfileId,
              note: subtype === "DOWNGRADE"
                ? `Will switch to ${autoRenewProductId ?? "another plan"} at the next renewal; current plan stays until then`
                : "Pending plan change reverted; current plan continues",
            });
            break;
          }

          case "DID_CHANGE_RENEWAL_STATUS": {
            if (subtype === "AUTO_RENEW_DISABLED") {
              const wasEnabled = !subscription.cancelAtPeriodEnd;
              await update({
                where: { id: subscription.id },
                data: {
                  cancelAtPeriodEnd: true,
                  ...(transactionInfo?.expiresDate && !isSandbox
                    ? { currentPeriodEnd: new Date(transactionInfo.expiresDate) }
                    : {}),
                },
              });
              if (wasEnabled) await notifyAutoRenewDisabled(subscription, subscription.expert.userId);
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


