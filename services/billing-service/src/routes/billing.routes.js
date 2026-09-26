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

// Validate UUID route params. Param handlers only apply to routes defined on
// the router that declares them, so this must live here, not in routes/index.js.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
for (const name of ["id", "expertProfileId"]) {
  router.param(name, (req, _res, next, value) => {
    if (!UUID_RE.test(value)) {
      const err = new Error(`Invalid UUID for parameter "${name}": ${value}`);
      err.statusCode = 400;
      err.code = "INVALID_UUID";
      return next(err);
    }
    next();
  });
}

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
    // The app-wide JSON parser runs first; it stashes the raw bytes on req.rawBody.
    const payload = req.rawBody ?? req.body;
    const result = await svc.handleStripeWebhook(payload, signature);
    log.info(`[Billing Service Webhook] Handled event: ${result.eventType || "ok"}`);
    return res.status(200).json(result);
  })
);

// Stripe-hosted onboarding sends the expert's browser back here. These pages
// are static on purpose: the browser is not signed in to XprtLink, so it can't
// mint a new link — the app re-reads status (or asks for a fresh link) itself.
function connectReturnPage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;color:#0f172a;padding:24px}
main{max-width:420px;text-align:center}h1{font-size:22px;margin:0 0 12px}p{font-size:16px;line-height:1.5;color:#475569;margin:0}
@media (prefers-color-scheme:dark){body{background:#020617;color:#f1f5f9}p{color:#94a3b8}}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

router.get("/connect/return", (_req, res) => {
  res
    .status(200)
    .type("html")
    .send(connectReturnPage("You're all set", "Close this window and go back to the XprtLink app to see your payout status."));
});

router.get("/connect/refresh", (_req, res) => {
  res
    .status(200)
    .type("html")
    .send(
      connectReturnPage(
        "This link has expired",
        "Close this window, go back to the XprtLink app and tap “Continue setup” to get a new secure link."
      )
    );
});

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

/**
 * POST /api/v1/billing/consultations/:id/release-hold
 * Internal-only — called by engagement-service when a consultation ends without
 * a billable call (declined / never connected / abandoned). Idempotent.
 */
router.post(
  "/consultations/:id/release-hold",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.releaseConsultationHold(req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("holdReleaseProcessed"), data });
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

// Release card holds of consultations that ended without a billable call, and
// expire abandoned requests. Idempotent.
router.post(
  "/consultations/release-holds",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.releaseStaleHolds(req.body ?? {});
    return ResponseFormatter.success(res, {
      message: getMessage("holdReleaseSweepComplete", { count: data.released }),
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


// ── Internal admin endpoints (called by admin-service, never by clients) ─────

// Unpaid balance + Stripe payout readiness for one expert.
router.get(
  "/payouts/experts/:expertProfileId/summary",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.getExpertPayoutSummary(req.params.expertProfileId);
    return ResponseFormatter.success(res, { message: getMessage("payoutSummaryLoaded"), data });
  })
);

// Admin "Pay out now": transfer all of an expert's unpaid earnings immediately.
router.post(
  "/payouts/experts/:expertProfileId/pay-now",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.payExpertNow(req.params.expertProfileId, {
      adminUserId: req.body?.adminUserId,
      amountCents: req.body?.amountCents ?? undefined,
    });
    return ResponseFormatter.success(res, {
      message: getMessage(data.transferred ? "payoutSent" : "payoutTransferFailed"),
      data,
    });
  })
);

// Admin "Retry transfer" for one failed payout.
router.post(
  "/payouts/:id/retry",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.retryPayout(req.params.id, { adminUserId: req.body?.adminUserId });
    return ResponseFormatter.success(res, {
      message: getMessage(data.transferred ? "payoutSent" : "payoutTransferFailed"),
      data,
    });
  })
);

// Admin refund of a charged consultation (full refund to the customer's card).
router.post(
  "/consultations/:id/refund",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.refundConsultation(req.params.id, {
      reason: req.body?.reason,
      adminUserId: req.body?.adminUserId,
    });
    return ResponseFormatter.success(res, { message: getMessage("consultationRefunded"), data });
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

/**
 * Public origin for Stripe's return/refresh URLs. Set CONNECT_RETURN_BASE_URL
 * on servers (live mode requires https); the host the gateway forwards is only
 * a fallback for local/dev.
 */
function connectReturnBaseUrl(req) {
  if (process.env.CONNECT_RETURN_BASE_URL) return process.env.CONNECT_RETURN_BASE_URL;
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim();
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${host}`;
}

// Stripe-hosted payout onboarding (replaces the in-app KYC + bank forms).
router.post(
  "/experts/connect/onboarding-link",
  requireRole("expert"),
  stripeGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.getConnectOnboardingLink(req.auth, { returnBaseUrl: connectReturnBaseUrl(req) });
    return ResponseFormatter.success(res, { message: getMessage("connectOnboardingLinkCreated"), data });
  })
);

router.get(
  "/experts/connect/status",
  requireRole("expert"),
  stripeGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.getConnectStatus(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("connectStatusLoaded"), data });
  })
);

router.post(
  "/experts/connect/dashboard-link",
  requireRole("expert"),
  stripeGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.getConnectDashboardLink(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("connectDashboardLinkCreated"), data });
  })
);

// Legacy in-app KYC / bank forms — kept for older app builds and legacy Custom
// accounts only; accounts from hosted onboarding get UPDATE_APP_FOR_PAYOUT_SETUP.
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


// Payouts actually sent to the signed-in expert's bank (vs. /earnings, which
// lists per-consultation earnings whether or not they have been paid out).
router.get(
  "/payouts",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.listMyPayouts(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("payoutsLoaded"), ...data });
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

