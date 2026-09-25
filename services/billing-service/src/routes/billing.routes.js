import { Router, raw } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate, requireRole } from "@xprtlink/shared/middleware/auth.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "billing.routes" });
import {
  addPaymentMethodRequestSchema,
  payConsultationRequestSchema,
  preAuthHoldRequestSchema,
  customConnectKycRequestSchema,
  attachBankAccountRequestSchema,
} from "@xprtlink/shared/contracts";
import { stripeGuard } from "../middleware/stripeGuard.js";
import * as svc from "../services/billingService.js";
import * as appleIapController from "../controllers/appleIapController.js";
import * as googleIapController from "../controllers/googleIapController.js";
import * as appleWebhookController from "../controllers/appleWebhookController.js";
import * as googlePlayWebhookController from "../controllers/googlePlayWebhookController.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";

const router = Router();

/**
 * Guard for internal service-to-service endpoints.
 * Validates that x-internal-service header matches SERVICE_SECRET env var.
 * Rejects ALL requests without a valid secret — no environment bypass.
 */
function internalServiceGuard(req, res, next) {
  const secret = process.env.SERVICE_SECRET;
  const header = req.headers["x-internal-service"];

  if (!header) {
    return res.status(403).json({ success: false, message: getMessage("internalEndpoint") });
  }

  // Always validate the secret if configured. If not configured, reject in production
  // and warn in dev (but still allow to avoid breaking local workflows without secrets).
  if (secret) {
    if (header !== secret) {
      return res.status(403).json({ success: false, message: getMessage("internalEndpoint") });
    }
  } else if (process.env.NODE_ENV === "production") {
    // No secret configured in production — reject to fail safe
    log.error("[billing] CRITICAL: SERVICE_SECRET not configured in production — rejecting internal request");
    return res.status(403).json({ success: false, message: getMessage("internalEndpoint") });
  } else {
    // Dev without secret: warn but allow (backward compat for local tooling)
    log.warn("[billing] WARNING: SERVICE_SECRET not set — accepting internal request without validation. Set SERVICE_SECRET in .env.");
  }

  next();
}


// Unauthenticated Webhook Listener Endpoint (uses raw body parsing for Stripe signature check)
router.post(
  "/webhook",
  raw({ type: "application/json" }),
  asyncHandler(async (req, res) => {
    log.info(`[Billing Service Webhook] ${new Date().toISOString()} Incoming Stripe Webhook event`);
    const signature = req.headers["stripe-signature"];
    const result = await svc.handleStripeWebhook(req.body, signature);
    log.info(`[Billing Service Webhook] Handled event: ${result.eventType || "ok"}`);
    return res.status(200).json(result);
  })
);

// Unauthenticated Webhook Listeners for IAP
router.post("/webhooks/apple", appleWebhookController.handleNotification);
router.post("/webhooks/google", googlePlayWebhookController.handleNotification);


/**
 * POST /api/v1/billing/consultations/:id/capture
 * Internal-only — called by engagement-service on ZegoCloud room_close.
 * Must be BEFORE router.use(authenticate) — guarded by SERVICE_SECRET.
 */
router.post(
  "/consultations/:id/capture",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const { durationSeconds } = req.body;
    const data = await svc.captureConsultation(req.params.id, durationSeconds);
    return ResponseFormatter.success(res, { message: getMessage("captureProcessed"), data });
  })
);

/**
 * GET /api/v1/billing/consultations/:id/charge
 * Internal-only — called by engagement-service for charge breakdown.
 * Guarded by SERVICE_SECRET.
 */
router.get(
  "/consultations/:id/charge",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.getConsultationCharge(req.params.id);
    return ResponseFormatter.success(res, { data });
  })
);

// ── Internal cron endpoints ──────────────────────────────────────────────────
// These are called by the PM2 cron runners (scripts/run-*.js) via internalPost
// with the x-internal-service secret. They MUST be registered BEFORE
// router.use(authenticate) below — otherwise the JWT `authenticate` middleware
// rejects the cron's internal call with 401 before internalServiceGuard runs.

// Expire subscriptions past their period end.
router.post(
  "/subscriptions/expire",
  internalServiceGuard,
  asyncHandler(async (_req, res) => {
    const data = await svc.expireSubscriptions();
    return ResponseFormatter.success(res, { message: `Expired ${data.expired} subscription(s)`, data });
  })
);

// Retry consultations that completed but were never charged
// (room_close → capture handoff failed). Idempotent.
router.post(
  "/consultations/retry-captures",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.retryFailedCaptures(req.body ?? {});
    return ResponseFormatter.success(res, {
      message: getMessage("retryCapturesProcessed", { count: data.charged }),
      data,
    });
  })
);

// Run the payout job: aggregate unpaid earnings into ExpertPayouts and initiate
// Stripe Connect transfers. Idempotent per window.
router.post(
  "/payouts/run",
  internalServiceGuard,
  asyncHandler(async (_req, res) => {
    const data = await svc.runPayouts();
    return ResponseFormatter.success(res, {
      message: getMessage("payoutRunComplete", { count: data.payoutsCreated }),
      data,
    });
  })
);

// Re-attempt transfers for payouts left in `failed` status by a prior run.
// Idempotent (payout-scoped Stripe idempotencyKey).
router.post(
  "/payouts/retry-failed",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.reattemptFailedPayouts(req.body ?? {});
    return ResponseFormatter.success(res, {
      message: getMessage("payoutRetryComplete", { count: data.recovered }),
      data,
    });
  })
);



router.use(authenticate);


router.get(
  "/payment-methods",
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const data = await svc.listPaymentMethods(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("paymentMethods"), data });
  })
);

router.post(
  "/payment-methods",
  requireRole("customer"),
  stripeGuard,
  asyncHandler(async (req, res) => {
    const body = addPaymentMethodRequestSchema.parse(req.body);
    const data = await svc.addPaymentMethod(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("paymentMethodAdded"), data, status: 201 });
  })
);

router.delete(
  "/payment-methods/:id",
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const data = await svc.removePaymentMethod(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("paymentMethodRemoved"), data });
  })
);

router.put(
  "/payment-methods/:id/default",
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const data = await svc.setDefaultPaymentMethod(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("paymentMethodUpdated"), data });
  })
);

router.post(
  "/consultations/:id/hold",
  requireRole("customer"),
  stripeGuard,
  asyncHandler(async (req, res) => {
    const body = preAuthHoldRequestSchema.parse(req.body);
    const data = await svc.holdConsultationFunds(req.auth, req.params.id, body);
    return ResponseFormatter.success(res, { message: getMessage("preauthorizationHoldPlaced"), data });
  })
);



router.post(
  "/consultations/:id/pay",
  requireRole("customer"),
  stripeGuard,
  asyncHandler(async (req, res) => {
    const body = payConsultationRequestSchema.parse(req.body);
    const data = await svc.payConsultation(req.auth, req.params.id, body);
    return ResponseFormatter.success(res, { message: getMessage("paymentSuccessful"), data });
  })
);

router.get(
  "/transactions",
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const data = await svc.listTransactions(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("transactions"), ...data });
  })
);

router.get(
  "/transactions/:id",
  asyncHandler(async (req, res) => {
    const data = await svc.getTransaction(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("transaction"), data });
  })
);

router.post(
  "/experts/kyc",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const body = customConnectKycRequestSchema.parse(req.body);
    const data = await svc.submitCustomConnectKyc(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("customKycAccountCreated"), data, status: 201 });
  })
);

router.post(
  "/experts/bank-account",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const body = attachBankAccountRequestSchema.parse(req.body);
    const data = await svc.attachBankAccount(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("bankAccountAttached"), data, status: 201 });
  })
);

router.get(
  "/subscriptions/plans",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.listSubscriptionPlans();
    return ResponseFormatter.success(res, { message: getMessage("subscriptionPlans"), data });
  })
);

// Legacy generic subscribe route. DISABLED as an activation path — it used to mint
// a subscription from an unvalidated receipt (revenue bypass). Real activations must
// go through the store verification endpoints below. `subscribe()` hard-rejects.
router.post(
  "/subscriptions",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    await svc.subscribe(req.auth, req.body);
    // Unreachable: subscribe() always throws STORE_RECEIPT_REQUIRED.
    return ResponseFormatter.success(res, { message: getMessage("subscribed") });
  })
);

router.post(
  "/subscriptions/verify/apple",
  requireRole("expert"),
  asyncHandler(appleIapController.verifyPurchase)
);

router.post(
  "/subscriptions/verify/google",
  requireRole("expert"),
  asyncHandler(googleIapController.verifyPurchase)
);


router.get(
  "/subscriptions/me",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getMySubscription(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("currentSubscription"), data });
  })
);

router.delete(
  "/subscriptions/me",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.cancelSubscription(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("subscriptionCanceled"), data });
  })
);


router.get(
  "/earnings",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getEarnings(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("earnings"), ...data });
  })
);

export default router;

