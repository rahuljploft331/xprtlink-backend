import Stripe from "stripe";
import { getSecretSync } from "@xprtlink/shared/config/secrets.js";

let stripe = null;

function requireStripe() {
  if (!stripe) {
    const key = getSecretSync("STRIPE_SECRET_KEY");
    if (key && key.trim() && !key.includes("placeholder")) {
      stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });
      console.log("[Stripe Service] Stripe SDK initialized successfully.");
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
}) {
  const sdk = requireStripe();
  return await sdk.paymentIntents.create({
    amount: amountCents,
    currency: currency.toLowerCase(),
    customer: customerStripeId,
    payment_method: stripePaymentMethodId,
    off_session: true,
    confirm: true,
    capture_method: "manual",
    metadata,
  });
}

/**
 * Captures a previously pre-authorized PaymentIntent.
 */
export async function capturePaymentIntent({ paymentIntentId, amountToCaptureCents }) {
  const sdk = requireStripe();
  return await sdk.paymentIntents.capture(paymentIntentId, {
    ...(amountToCaptureCents ? { amount_to_capture: amountToCaptureCents } : {}),
  });
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
}) {
  const sdk = requireStripe();
  return await sdk.paymentIntents.create({
    amount: amountCents,
    currency: currency.toLowerCase(),
    customer: customerStripeId,
    payment_method: stripePaymentMethodId,
    off_session: true,
    confirm: true,
    metadata,
  });
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
 */
export async function createCustomConnectAccount({
  expertEmail,
  firstName,
  lastName,
  dob,
  address,
  ssnLast4,
  frontDocumentFileId,
  backDocumentFileId,
  userIpAddress = "127.0.0.1",
}) {
  const sdk = requireStripe();
  return await sdk.accounts.create({
    type: "custom",
    country: address.country || "US",
    email: expertEmail,
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    business_type: "individual",
    individual: {
      first_name: firstName,
      last_name: lastName,
      dob: {
        day: dob.day,
        month: dob.month,
        year: dob.year,
      },
      address: {
        line1: address.line1,
        city: address.city,
        state: address.state,
        postal_code: address.postalCode,
        country: address.country || "US",
      },
      ssn_last_4: ssnLast4,
      verification: {
        document: {
          front: frontDocumentFileId,
          back: backDocumentFileId || undefined,
        },
      },
    },
    tos_acceptance: {
      date: Math.floor(Date.now() / 1000),
      ip: userIpAddress,
    },
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
