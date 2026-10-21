import { AppError } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { getManagementUrl } from "./subscriptionStore.js";
import {
  ENTITLED_STATUSES,
  PLAN_CHANGE,
  SUBSCRIPTION_ERROR,
  evaluatePlanChange,
  hasActiveEntitlement,
} from "./subscriptionRules.js";
const log = logger.child({ module: "subscriptionOwnership" });

/** Explicit opt-in only; never inferred from NODE_ENV or a client-supplied flag. */
const transferAllowed = () => process.env.SUBSCRIPTION_ALLOW_TRANSFER === "true";

/** 409 for a store purchase that another application account still owns. */
export function ownedByAnotherAccountError(store) {
  return new AppError(getMessage("subscriptionAlreadyLinkedToAnotherAccount"), {
    statusCode: 409,
    code: SUBSCRIPTION_ERROR.ALREADY_LINKED,
    details: {
      title: getMessage("subscriptionOwnedByAnotherAccountTitle"),
      alertMessage: getMessage("subscriptionOwnedByAnotherAccountMessage"),
      store,
      managementUrl: getManagementUrl(store),
    },
  });
}

/** Another account's row for this store purchase, or null. */
export function findForeignOwner(db, { store, externalSubscriptionId, expertProfileId }) {
  return db.expertSubscription.findFirst({
    where: { store, externalSubscriptionId, expertProfileId: { not: expertProfileId } },
  });
}

/**
 * Atomically attach a VERIFIED store purchase to `expertProfileId`.
 *
 * Inside one transaction, serialised per purchase and per account by advisory
 * locks, it (1) refuses a purchase another account still owns, (2) applies the
 * plan hierarchy against the account's other entitled subscriptions, (3) retires
 * those superseded rows and (4) upserts the row. The check and the write share
 * the lock, so two accounts claiming one purchase cannot both succeed.
 *
 * `linkedExternalId` is the previous purchase token Google reports for a plan
 * replacement; it keeps an in-store upgrade/renewal chain from being judged as a
 * second subscription.
 */
export async function activateStoreSubscription(db, p) {
  const { store, externalSubscriptionId, linkedExternalId = null, plan, expertProfileId, now, periodEnd } = p;

  return db.$transaction(async (tx) => {
    // Fixed order → no deadlocks between concurrent claims.
    const lockKeys = [`sub-purchase:${store}:${externalSubscriptionId}`, `sub-expert:${expertProfileId}`].sort();
    for (const key of lockKeys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }

    // 1. Ownership
    const foreign = await findForeignOwner(tx, { store, externalSubscriptionId, expertProfileId });
    if (foreign) {
      if (hasActiveEntitlement(foreign, now)) {
        if (!transferAllowed()) {
          log.warn({ store, ownerExpertId: foreign.expertProfileId, claimantExpertId: expertProfileId }, "[activate] purchase owned by another account — blocked");
          throw ownedByAnotherAccountError(store);
        }
        log.info({ store, fromExpertId: foreign.expertProfileId, toExpertId: expertProfileId }, "[activate] transferring purchase (SUBSCRIPTION_ALLOW_TRANSFER)");
        await tx.expertSubscription.update({ where: { id: foreign.id }, data: { status: "canceled", canceledAt: now } });
      } else {
        await tx.expertSubscription.update({ where: { id: foreign.id }, data: { status: "expired" } });
      }
    }

    // 2. Plan hierarchy against this account's other entitled subscriptions
    const others = (
      await tx.expertSubscription.findMany({
        where: {
          expertProfileId,
          status: { in: ENTITLED_STATUSES },
          NOT: { store, externalSubscriptionId },
        },
        include: { plan: true },
      })
    ).filter((s) => hasActiveEntitlement(s, now) && !(s.store === store && s.externalSubscriptionId === linkedExternalId));

    let upgradedFrom = null;
    for (const cur of others) {
      const verdict = evaluatePlanChange(cur.plan?.code, plan.code);
      if (!verdict.allowed) {
        log.warn({ expertProfileId, from: cur.plan?.code, to: plan.code, relation: verdict.relation }, "[activate] plan change blocked");
        throw new AppError(getMessage(verdict.messageKey), { statusCode: 409, code: verdict.code });
      }
      if (verdict.relation === PLAN_CHANGE.UPGRADE) upgradedFrom = cur.plan.code;
    }

    // 3. Retire superseded rows (unchanged behaviour: only one live row per account)
    await tx.expertSubscription.updateMany({
      where: { expertProfileId, status: "active", externalSubscriptionId: { not: externalSubscriptionId } },
      data: { status: "canceled", canceledAt: now, cancelAtPeriodEnd: false },
    });

    // 4. Idempotent on (store, externalSubscriptionId): restore/renewal never duplicates
    const subscription = await tx.expertSubscription.upsert({
      where: { store_externalSubscriptionId: { store, externalSubscriptionId } },
      update: {
        expertProfileId,
        planId: plan.id,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
      },
      create: {
        expertProfileId,
        planId: plan.id,
        store,
        externalSubscriptionId,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
      include: { plan: true },
    });

    await tx.expertProfile.updateMany({
      where: { id: expertProfileId, verificationStatus: "approved", searchEligible: false },
      data: { searchEligible: true },
    });

    return Object.assign(subscription, { upgradedFrom });
  });
}
