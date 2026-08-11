import crypto from "crypto";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const isLiveKeyAvailable = Boolean(stripeSecretKey && !stripeSecretKey.includes("placeholder"));

let stripe = null;
if (isLiveKeyAvailable) {
  try {
    const StripeModule = (await import("stripe")).default;
    stripe = new StripeModule(stripeSecretKey, { apiVersion: "2024-12-18.acacia" });
    console.log("[Stripe Service] Stripe SDK initialized successfully.");
  } catch (_err) {
    console.warn("[Stripe Service] Stripe package not found or failed to load. Falling back to local stub mode.");
  }
}


/**
 * Creates or retrieves a Stripe Customer object.
 */
export async function getOrCreateStripeCustomer({ email, name, metadata = {} }) {
  if (!stripe) {
    return { id: `cus_stub_${crypto.randomUUID()}` };
  }

  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) {
    return existing.data[0];
  }

  return await stripe.customers.create({
    email,
    name,
    metadata,
  });
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
  if (!stripe) {
    return {
      id: `pi_hold_stub_${crypto.randomUUID()}`,
      status: "requires_capture",
      amount: amountCents,
    };
  }

  return await stripe.paymentIntents.create({
    amount: amountCents,
    currency: currency.toLowerCase(),
    customer: customerStripeId,
    payment_method: stripePaymentMethodId,
    off_session: true,
    confirm: true,
    capture_method: "manual", // Reserves funds on customer card
    metadata,
  });
}

/**
 * Captures a previously pre-authorized hold when the consultation completes.
 */
export async function captureConsultationCharge({
  stripePaymentIntentId,
  paymentIntentId,
  customerStripeId,
  stripePaymentMethodId,
  finalCents,
  currency = "usd",
}) {
  const intentId = stripePaymentIntentId || paymentIntentId;

  if (!stripe) {
    return {
      id: intentId || `pi_stub_${crypto.randomUUID()}`,
      status: "succeeded",
      amount_captured: finalCents,
    };
  }

  if (intentId) {
    if (intentId.startsWith("pi_hold_stub_")) {
      return {
        id: intentId,
        status: "succeeded",
        amount_captured: finalCents,
      };
    }
    return await stripe.paymentIntents.capture(intentId, {
      ...(finalCents ? { amount_to_capture: finalCents } : {}),
    });
  }

  return await stripe.paymentIntents.create({
    amount: finalCents,
    currency: currency.toLowerCase(),
    customer: customerStripeId,
    payment_method: stripePaymentMethodId,
    off_session: true,
    confirm: true,
  });
}


/**
 * Uploads identity verification document (Passport / Driver's License) to Stripe Files.
 */
export async function uploadIdentityDocument({ fileBuffer, mimeType, fileName = "id_doc.jpg" }) {
  if (!stripe) {
    return { id: `file_stub_${crypto.randomUUID()}` };
  }

  return await stripe.files.create({
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
  if (!stripe) {
    return { id: `acct_stub_${crypto.randomUUID()}` };
  }

  return await stripe.accounts.create({
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
  if (!stripe || stripeAccountId?.startsWith("acct_stub_")) {
    return { id: `ba_stub_${crypto.randomUUID()}` };
  }

  const bankToken = await stripe.tokens.create({
    bank_account: {
      country: "US",
      currency: "usd",
      account_holder_name: accountHolderName,
      account_holder_type: "individual",
      routing_number: routingNumber,
      account_number: accountNumber,
    },
  });

  return await stripe.accounts.createExternalAccount(stripeAccountId, {
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
  if (!stripe || destinationStripeAccountId?.startsWith("acct_stub_")) {
    return { id: `tr_stub_${crypto.randomUUID()}` };
  }

  return await stripe.transfers.create(
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
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret || webhookSecret.includes("dummy")) {
    return JSON.parse(payload.toString());
  }

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
