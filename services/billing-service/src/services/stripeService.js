import Stripe from "stripe";
import { getSecretSync } from "@xprtlink/shared/config/secrets.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "stripeService" });

let stripe = null;

function requireStripe() {
  if (!stripe) {
    const key = getSecretSync("STRIPE_SECRET_KEY");
    if (key && key.trim() && !key.includes("placeholder")) {
      stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });
      log.info("[Stripe Service] Stripe SDK initialized successfully.");
    } else {
      const err = new Error("Stripe SDK not initialized (missing STRIPE_SECRET_KEY)");
      err.code = "STRIPE_UNAVAILABLE";
      throw err;
    }
  }
  return stripe;
}

/**
 * Creates or retrieves a Stripe Customer object by email.
 */
export async function getOrCreateStripeCustomer({ email, name, metadata = {} }) {
  const sdk = requireStripe();
  const existing = await sdk.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];
  return await sdk.customers.create({ email, name, metadata });
}

/**
 * Attaches a PaymentMethod to a Stripe Customer.
 */
export async function attachPaymentMethod({ stripePaymentMethodId, stripeCustomerId }) {
  const sdk = requireStripe();
  return await sdk.paymentMethods.attach(stripePaymentMethodId, { customer: stripeCustomerId });
}

/**
 * Retrieves a PaymentMethod's details (brand, last4, exp) from Stripe.
 */
export async function retrievePaymentMethod({ stripePaymentMethodId }) {
  const sdk = requireStripe();
  return await sdk.paymentMethods.retrieve(stripePaymentMethodId);
}

/**
 * Detaches a PaymentMethod from a Stripe Customer.
 */
export async function detachPaymentMethod({ stripePaymentMethodId }) {
  const sdk = requireStripe();
  return await sdk.paymentMethods.detach(stripePaymentMethodId);
}
/**
 * Pre-authorizes (holds) funds on a customer's card prior to a consultation.
 * Uses `capture_method: 'manual'` to check and reserve funds without charging immediately.
 */
export async function createPreAuthHold({
  customerStripeId,
  stripePaymentMethodId,
  amountCents,
  currency = "usd",
  metadata = {},
  consultationId,
}) {
  const sdk = requireStripe();
  // Idempotency: a retried hold for the same consultation + card + amount reuses
  // this key, so a dropped response / client retry can never place a second hold.
  // The card and amount are part of the key so a declined card can be retried
  // with a different one (Stripe caches the decline against the key for 24h).
  const options = consultationId
    ? { idempotencyKey: `hold_${consultationId}_${stripePaymentMethodId}_${amountCents}` }
    : {};
  return await sdk.paymentIntents.create(
    {
      amount: amountCents,
      currency: currency.toLowerCase(),
      customer: customerStripeId,
      payment_method: stripePaymentMethodId,
      off_session: true,
      confirm: true,
      capture_method: "manual",
      metadata,
    },
    options
  );
}

/**
 * Captures a previously pre-authorized PaymentIntent.
 */
export async function capturePaymentIntent({ paymentIntentId, amountToCaptureCents }) {
  const sdk = requireStripe();
  // Idempotency: keyed on the PaymentIntent id + amount, so a retried capture
  // collapses to a single capture rather than erroring or double-processing.
  // (A second capture with another amount is rejected by Stripe anyway — a PI
  // can only be captured once.)
  const options = paymentIntentId
    ? { idempotencyKey: `capture_${paymentIntentId}_${amountToCaptureCents ?? "full"}` }
    : {};
  return await sdk.paymentIntents.capture(
    paymentIntentId,
    {
      ...(amountToCaptureCents ? { amount_to_capture: amountToCaptureCents } : {}),
    },
    options
  );
}

/**
 * Creates and immediately confirms a new PaymentIntent (direct charge without prior hold).
 */
export async function createAndConfirmPaymentIntent({
  customerStripeId,
  stripePaymentMethodId,
  amountCents,
  currency = "usd",
  metadata = {},
  consultationId,
  idempotencyKey,
}) {
  const sdk = requireStripe();
  // Idempotency: a retried direct charge for the same consultation reuses this key,
  // so a dropped response / client retry can never charge the customer twice.
  const key = idempotencyKey ?? (consultationId ? `charge_${consultationId}` : null);
  const options = key ? { idempotencyKey: key } : {};
  return await sdk.paymentIntents.create(
    {
      amount: amountCents,
      currency: currency.toLowerCase(),
      customer: customerStripeId,
      payment_method: stripePaymentMethodId,
      off_session: true,
      confirm: true,
      metadata,
    },
    options
  );
}

/**
 * Retrieves a PaymentIntent (status, amount_capturable, amount_received, ...).
 */
export async function retrievePaymentIntent(paymentIntentId) {
  const sdk = requireStripe();
  return await sdk.paymentIntents.retrieve(paymentIntentId);
}

/**
 * Cancels an uncaptured PaymentIntent, releasing the authorization hold on the
 * customer's card. Safe to call repeatedly: a PI that is already canceled (or was
 * captured) is returned as-is instead of throwing.
 */
export async function cancelPaymentIntent(paymentIntentId, { reason = "abandoned" } = {}) {
  const sdk = requireStripe();
  const pi = await sdk.paymentIntents.retrieve(paymentIntentId);
  if (pi.status === "canceled" || pi.status === "succeeded") return pi;
  return await sdk.paymentIntents.cancel(
    paymentIntentId,
    { cancellation_reason: reason },
    { idempotencyKey: `cancel_${paymentIntentId}` }
  );
}

/**
 * Refunds a captured PaymentIntent in full. Idempotent per PaymentIntent.
 */
export async function refundPaymentIntent({ paymentIntentId, metadata = {} }) {
  const sdk = requireStripe();
  // source=xprtlink_admin lets the charge.refunded webhook tell portal refunds
  // (already recorded) from ones made directly in the Stripe Dashboard.
  return await sdk.refunds.create(
    { payment_intent: paymentIntentId, reason: "requested_by_customer", metadata: { ...metadata, source: "xprtlink_admin" } },
    { idempotencyKey: `refund_${paymentIntentId}` }
  );
}

/** All refunds on a charge (portal and Stripe Dashboard ones). */
export async function listRefundsForCharge(chargeId) {
  const sdk = requireStripe();
  const list = await sdk.refunds.list({ charge: chargeId, limit: 100 });
  return list.data;
}

/**
 * Platform balance available for transfers right now, in cents, per currency.
 * Card funds sit in `pending` until they settle (~2 days) and cannot be
 * transferred to Connect accounts before then.
 */
export async function getAvailableBalanceCents(currency = "usd") {
  const sdk = requireStripe();
  const balance = await sdk.balance.retrieve();
  const cur = currency.toLowerCase();
  const sum = (list) =>
    (list ?? []).filter((b) => b.currency === cur).reduce((acc, b) => acc + b.amount, 0);
  return { availableCents: sum(balance.available), pendingCents: sum(balance.pending) };
}

/**
 * Whether a Connect account can receive transfers, and what Stripe still needs.
 * Works for legacy Custom accounts and Accounts v2 recipients alike: a v2
 * account read through the v1 endpoint still reports `capabilities.transfers`.
 */
export async function getConnectAccountStatus(stripeAccountId) {
  const sdk = requireStripe();
  const account = await sdk.accounts.retrieve(stripeAccountId);
  const bank = (account.external_accounts?.data ?? []).find((a) => a.default_for_currency) ??
    account.external_accounts?.data?.[0] ??
    null;
  return {
    transfersActive: account.capabilities?.transfers === "active",
    transfersCapability: account.capabilities?.transfers ?? null,
    payoutsEnabled: Boolean(account.payouts_enabled),
    requirementsDue: account.requirements?.currently_due ?? [],
    pendingVerification: account.requirements?.pending_verification ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
    // Legacy Custom accounts (platform-collected KYC) vs. Stripe-collected ones.
    legacyCustom: account.type === "custom",
    bankLast4: bank?.last4 ?? null,
    bankName: bank?.bank_name ?? null,
  };
}

// ── Accounts v2 (Stripe-hosted onboarding) ──────────────────────────────────
// stripe-node 17 has no typed v2 namespace; rawRequest reaches the v2 endpoints
// with their own API version, leaving every v1 call on the pinned version.
const V2_API_VERSION = process.env.STRIPE_V2_API_VERSION || "2026-08-26.dahlia";

/**
 * Create an expert's connected account: an Accounts v2 `recipient` (receives
 * transfers only). Stripe collects KYC and bank details through hosted
 * onboarding; the platform stays liable for losses and pays Stripe fees, which
 * is what separate charges and transfers require. `dashboard: express` is the
 * only dashboard that lets Stripe own requirement collection in that setup.
 */
export async function createRecipientAccount({ email, displayName, expertProfileId }) {
  const sdk = requireStripe();
  return await sdk.rawRequest(
    "POST",
    "/v2/core/accounts",
    {
      ...(email ? { contact_email: email } : {}),
      ...(displayName ? { display_name: displayName } : {}),
      dashboard: "express",
      identity: { country: "us", entity_type: "individual" },
      configuration: {
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      defaults: {
        currency: "usd",
        responsibilities: { fees_collector: "application", losses_collector: "application" },
      },
      metadata: { expertProfileId },
    },
    { apiVersion: V2_API_VERSION, idempotencyKey: `recipient_account_${expertProfileId}` }
  );
}

/**
 * Single-use URL (expires in minutes) to Stripe's hosted onboarding form.
 * v2 recipients use a v2 Account Link; legacy Custom accounts use the v1
 * hosted onboarding for Custom accounts, which asks only for what is missing.
 */
export async function createOnboardingLink({ stripeAccountId, legacyCustom, returnUrl, refreshUrl }) {
  const sdk = requireStripe();
  if (legacyCustom) {
    const link = await sdk.accountLinks.create({
      account: stripeAccountId,
      type: "account_onboarding",
      collection_options: { fields: "eventually_due" },
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000).toISOString() };
  }
  const link = await sdk.rawRequest(
    "POST",
    "/v2/core/account_links",
    {
      account: stripeAccountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: { configurations: ["recipient"], return_url: returnUrl, refresh_url: refreshUrl },
      },
    },
    { apiVersion: V2_API_VERSION }
  );
  return { url: link.url, expiresAt: link.expires_at };
}

/**
 * Single-use login link to the expert's Stripe Express Dashboard (payout
 * history, bank details). Only for Stripe-collected (non-Custom) accounts.
 */
export async function createDashboardLoginLink(stripeAccountId) {
  const sdk = requireStripe();
  const link = await sdk.accounts.createLoginLink(stripeAccountId);
  return { url: link.url };
}

/**
 * Uploads identity verification document (Passport / Driver's License) to Stripe Files.
 */
export async function uploadIdentityDocument({ fileBuffer, mimeType, fileName = "id_doc.jpg" }) {
  const sdk = requireStripe();
  return await sdk.files.create({
    file: {
      data: fileBuffer,
      name: fileName,
      type: mimeType,
    },
    purpose: "identity_document",
  });
}

/**
 * Creates a Stripe Custom Connect Account for an Expert (fully native white-label KYC).
 *
 * NOTE: Stripe deprecated POST /v1/accounts for new Connect integrations.
 * To keep using Custom accounts (v1), you MUST enable "Accounts v1 support" in the
 * Stripe Dashboard → Developers → API policies → feat_accounts_v1_support.
 * URL: https://dashboard.stripe.com/settings/developers/api-policies/feat_accounts_v1_support
 *
 * If that setting is enabled, this function works as-is with the existing apiVersion.
 * The `verification.document` block is omitted when no document file IDs are provided
 * to avoid sending an empty object that Stripe rejects.
 */
/** Business profile the platform supplies for every expert account. */
function expertBusinessProfile() {
  return {
    // 7392 = Management, Consulting & Public Relations Services. Override per env if needed.
    mcc: process.env.STRIPE_CONNECT_MCC || "7392",
    product_description: "Paid one-to-one video consultations delivered through the XprtLink app.",
  };
}

/** `individual` block for an expert, sent on create and on re-submission. */
function expertIndividual({
  expertEmail,
  phone,
  firstName,
  lastName,
  dob,
  address,
  ssnLast4,
  idNumber,
  frontDocumentFileId,
  backDocumentFileId,
}) {
  return {
    first_name: firstName,
    last_name: lastName,
    ...(expertEmail ? { email: expertEmail } : {}),
    ...(phone ? { phone } : {}),
    dob: { day: dob.day, month: dob.month, year: dob.year },
    address: {
      line1: address.line1,
      city: address.city,
      state: address.state,
      postal_code: address.postalCode,
      country: address.country || "US",
    },
    ssn_last_4: ssnLast4,
    ...(idNumber ? { id_number: idNumber } : {}),
    // Only include document verification if at least a front doc ID was provided
    // (Stripe rejects an empty verification object).
    ...(frontDocumentFileId
      ? {
          verification: {
            document: {
              front: frontDocumentFileId,
              ...(backDocumentFileId ? { back: backDocumentFileId } : {}),
            },
          },
        }
      : {}),
  };
}

export async function createCustomConnectAccount(details) {
  const sdk = requireStripe();
  const { expertEmail, address, userIpAddress = "127.0.0.1" } = details;

  return await sdk.accounts.create({
    type: "custom",
    country: address.country || "US",
    email: expertEmail,
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    business_type: "individual",
    business_profile: expertBusinessProfile(),
    individual: expertIndividual(details),
    tos_acceptance: {
      date: Math.floor(Date.now() / 1000),
      ip: userIpAddress,
    },
  });
}

/**
 * KYC re-submission for an expert who already has a Connect account: update it
 * in place (creating another would orphan the first and lose its bank account).
 */
export async function updateCustomConnectAccount(stripeAccountId, details) {
  const sdk = requireStripe();
  return await sdk.accounts.update(stripeAccountId, {
    email: details.expertEmail,
    business_profile: expertBusinessProfile(),
    individual: expertIndividual(details),
  });
}

/**
 * Attaches a bank account token to an Expert's Stripe Connect Account for payouts.
 */
export async function attachExternalBankAccount({
  stripeAccountId,
  routingNumber,
  accountNumber,
  accountHolderName,
}) {
  const sdk = requireStripe();
  const bankToken = await sdk.tokens.create({
    bank_account: {
      country: "US",
      currency: "usd",
      account_holder_name: accountHolderName,
      account_holder_type: "individual",
      routing_number: routingNumber,
      account_number: accountNumber,
    },
  });

  return await sdk.accounts.createExternalAccount(stripeAccountId, {
    external_account: bankToken.id,
  });
}

/**
 * Transfers net consultation earnings to Expert's Stripe Connect account.
 * Per-consultation scope (idempotency keyed on the consultation).
 */
export async function transferEarningsToExpert({
  amountCents,
  destinationStripeAccountId,
  consultationId,
}) {
  const sdk = requireStripe();
  return await sdk.transfers.create(
    {
      amount: amountCents,
      currency: "usd",
      destination: destinationStripeAccountId,
      transfer_group: `CONSULTATION_${consultationId}`,
    },
    {
      idempotencyKey: `transfer_${consultationId}`,
    }
  );
}

/**
 * Transfers an aggregated PAYOUT (many consultations rolled into one) to an
 * Expert's Stripe Connect account. Payout-scoped: the transfer_group and
 * idempotencyKey are keyed on the payout id, so a retried payout-run can never
 * double-send the same payout.
 */
export async function transferEarningsToExpertPayout({
  amountCents,
  currency = "usd",
  destinationStripeAccountId,
  payoutId,
}) {
  const sdk = requireStripe();
  return await sdk.transfers.create(
    {
      amount: amountCents,
      currency: (currency || "usd").toLowerCase(),
      destination: destinationStripeAccountId,
      transfer_group: `PAYOUT_${payoutId}`,
    },
    {
      idempotencyKey: `payout_${payoutId}`,
    }
  );
}

/**
 * The transfer already sent for a payout, if any (matched on transfer_group).
 * Used before re-sending: Stripe's idempotency key only lasts 24h, so a retry
 * after that would otherwise pay the expert twice.
 */
export async function findTransferForPayout(payoutId) {
  const sdk = requireStripe();
  const list = await sdk.transfers.list({ transfer_group: `PAYOUT_${payoutId}`, limit: 1 });
  return list.data[0] ?? null;
}

/**
 * Constructs and verifies incoming Stripe Webhook events.
 */
export function constructWebhookEvent(payload, signature) {
  const sdk = requireStripe();
  const webhookSecret = getSecretSync("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret || webhookSecret.includes("dummy") || webhookSecret.includes("placeholder")) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  return sdk.webhooks.constructEvent(payload, signature, webhookSecret);
}
