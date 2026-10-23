import { AppError } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { logSubscriptionEvent } from "./subscriptionLog.js";
import { fetchAppleState, fetchGoogleState, getManagementUrl } from "./subscriptionStore.js";
import {
  ENTITLED_STATUSES,
  PLAN_CHANGE,
  SUBSCRIPTION_ERROR,
  evaluatePlanChange,
  hasActiveEntitlement,
} from "./subscriptionRules.js";
const log = logger.child({ module: "subscriptionOwnership" });

/** Explicit opt-in only; never inferred from NODE_ENV or a client-supplied flag. */
export const transferAllowed = () => process.env.SUBSCRIPTION_ALLOW_TRANSFER === "true";

/**
 * 503 for "we could not reach the store, so we cannot say who owns this purchase".
 * Kept distinct from the 409 below: that one is a verdict, this one is a retry.
 */
export function storeVerificationUnavailableError(store) {
  return new AppError(getMessage("storeVerificationFailed"), {
    statusCode: 503,
    code: SUBSCRIPTION_ERROR.STORE_VERIFICATION_FAILED,
    details: { store, retryable: true },
  });
}

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
 * Does another account's stored row still hold a live entitlement in the store?
 * The stored period end can be synthetic (sandbox grants 30 days), so an owner who
 * cancelled and let Apple/Google expire the subscription would otherwise block the
 * purchase until that date. Fails closed: if the store can't be reached, the stored
 * row decides.
 */
export async function ownerHasLiveEntitlement(owner, now) {
  if (!hasActiveEntitlement(owner, now)) return "lapsed";

  let live;
  try {
    live = owner.store === "apple"
      ? await fetchAppleState(owner.externalSubscriptionId, { throwOnError: true })
      : await fetchGoogleState(owner.externalSubscriptionId, { throwOnError: true });
  } catch {
    // The store never answered, so we cannot say whether the owner is still entitled.
    // Callers surface a retry rather than a verdict about ownership.
    return "unknown";
  }

  // The store answered definitively but has no record (or Apple is not configured):
  // the stored row decides, which keeps the purchase with its current owner.
  if (!live) return "live";

  const lapsed = owner.store === "apple"
    ? live.status === 2 || live.status === 5 // expired | revoked
    : live.state === "SUBSCRIPTION_STATE_EXPIRED";
  const pastExpiry = live.expiry instanceof Date && live.expiry.getTime() <= now.getTime();
  return lapsed || pastExpiry ? "lapsed" : "live";
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

  // The store round-trip below runs inside this transaction (it must share the advisory
  // lock with the write). Apple's retry budget alone can exceed Prisma's 5s default,
  // which would abort the transaction with P2028 on the success path.
  return db.$transaction(async (tx) => {
    // Fixed order → no deadlocks between concurrent claims.
    const lockKeys = [`sub-purchase:${store}:${externalSubscriptionId}`, `sub-expert:${expertProfileId}`].sort();
    for (const key of lockKeys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }

    // 1. Ownership
    const foreign = await findForeignOwner(tx, { store, externalSubscriptionId, expertProfileId });
    if (foreign) {
      const ownerState = await ownerHasLiveEntitlement(foreign, now);
      if (ownerState === "unknown") {
        log.warn({ store, ownerExpertId: foreign.expertProfileId, claimantExpertId: expertProfileId }, "[activate] store unreachable — ownership undecided");
        logSubscriptionEvent("BLOCKED", { store, plan: plan.code, expertProfileId, note: `Could not reach the ${store} store to confirm who owns this purchase — ask the user to retry` });
        throw storeVerificationUnavailableError(store);
      }
      if (ownerState === "live") {
        if (!transferAllowed()) {
          log.warn({ store, ownerExpertId: foreign.expertProfileId, claimantExpertId: expertProfileId }, "[activate] purchase owned by another account — blocked");
          logSubscriptionEvent("BLOCKED", { store, plan: plan.code, expertProfileId, note: `Purchase already belongs to another account (expert=${String(foreign.expertProfileId).slice(0, 8)}) and is still active in the store` });
          throw ownedByAnotherAccountError(store);
        }
        log.info({ store, fromExpertId: foreign.expertProfileId, toExpertId: expertProfileId }, "[activate] transferring purchase (SUBSCRIPTION_ALLOW_TRANSFER)");
        await tx.expertSubscription.update({ where: { id: foreign.id }, data: { status: "canceled", canceledAt: now } });
      } else {
        logSubscriptionEvent("EXPIRED", { store, expertProfileId: foreign.expertProfileId, note: `Previous owner's subscription had lapsed; released to expert=${String(expertProfileId).slice(0, 8)}` });
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
      data: { searchEligible: true, availabilityStatus: "online" },
    });

    return Object.assign(subscription, { upgradedFrom });
  }, { timeout: 30_000, maxWait: 10_000 });
}
