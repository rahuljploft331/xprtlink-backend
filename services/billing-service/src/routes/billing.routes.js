import { Router, raw } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate, requireRole } from "@xprtlink/shared/middleware/auth.js";
import {
  addPaymentMethodRequestSchema,
  payConsultationRequestSchema,
  preAuthHoldRequestSchema,
  customConnectKycRequestSchema,
  attachBankAccountRequestSchema,
  subscribeRequestSchema,
} from "@xprtlink/shared/contracts";
import { stripeGuard } from "../middleware/stripeGuard.js";
import * as svc from "../services/billingService.js";


const router = Router();

// Unauthenticated Webhook Listener Endpoint (uses raw body parsing for Stripe signature check)
router.post(
  "/webhook",
  raw({ type: "application/json" }),
  asyncHandler(async (req, res) => {
    console.log(`[Billing Service Webhook] ${new Date().toISOString()} Incoming Stripe Webhook event`);
    const signature = req.headers["stripe-signature"];
    const result = await svc.handleStripeWebhook(req.body, signature);
    console.log(`[Billing Service Webhook] Handled event: ${result.eventType || "ok"}`);
    return res.status(200).json(result);
  })
);


router.use(authenticate);

router.get(
  "/payment-methods",
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const data = await svc.listPaymentMethods(req.auth);
    return ResponseFormatter.success(res, { message: "Payment methods", data });
  })
);

router.post(
  "/payment-methods",
  requireRole("customer"),
  stripeGuard,
  asyncHandler(async (req, res) => {
    const body = addPaymentMethodRequestSchema.parse(req.body);
    const data = await svc.addPaymentMethod(req.auth, body);
    return ResponseFormatter.success(res, { message: "Payment method added", data, status: 201 });
  })
);

router.delete(
  "/payment-methods/:id",
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const data = await svc.removePaymentMethod(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: "Payment method removed", data });
  })
);

router.post(
  "/consultations/:id/hold",
  requireRole("customer"),
  stripeGuard,
  asyncHandler(async (req, res) => {
    const body = preAuthHoldRequestSchema.parse(req.body);
    const data = await svc.holdConsultationFunds(req.auth, req.params.id, body);
    return ResponseFormatter.success(res, { message: "Pre-authorization hold placed", data });
  })
);

router.post(
  "/consultations/:id/pay",
  requireRole("customer"),
  stripeGuard,
  asyncHandler(async (req, res) => {
    const body = payConsultationRequestSchema.parse(req.body);
    const data = await svc.payConsultation(req.auth, req.params.id, body);
    return ResponseFormatter.success(res, { message: "Payment successful", data });
  })
);

router.get(
  "/transactions/:id",
  asyncHandler(async (req, res) => {
    const data = await svc.getTransaction(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: "Transaction", data });
  })
);

router.post(
  "/experts/kyc",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const body = customConnectKycRequestSchema.parse(req.body);
    const data = await svc.submitCustomConnectKyc(req.auth, body);
    return ResponseFormatter.success(res, { message: "Custom KYC account created", data, status: 201 });
  })
);

router.post(
  "/experts/bank-account",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const body = attachBankAccountRequestSchema.parse(req.body);
    const data = await svc.attachBankAccount(req.auth, body);
    return ResponseFormatter.success(res, { message: "Bank account attached", data, status: 201 });
  })
);

router.get(
  "/subscriptions/plans",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.listSubscriptionPlans();
    return ResponseFormatter.success(res, { message: "Subscription plans", data });
  })
);

router.post(
  "/subscriptions",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const body = subscribeRequestSchema.parse(req.body);
    const data = await svc.subscribe(req.auth, body);
    return ResponseFormatter.success(res, { message: "Subscribed", data, status: 201 });
  })
);

router.get(
  "/subscriptions/me",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getMySubscription(req.auth);
    return ResponseFormatter.success(res, { message: "Current subscription", data });
  })
);

router.delete(
  "/subscriptions/me",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.cancelSubscription(req.auth);
    return ResponseFormatter.success(res, { message: "Subscription cancelled", data });
  })
);


router.get(
  "/earnings",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getEarnings(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: "Earnings", ...data });
  })
);

// ── Internal cron endpoint — expire subscriptions past their period end ──────
// Should only be called by your PM2 cron task or an internal scheduler.
// Protect this in production with an internal secret header or restrict to localhost.
router.post(
  "/subscriptions/expire",
  asyncHandler(async (_req, res) => {
    const data = await svc.expireSubscriptions();
    return ResponseFormatter.success(res, { message: `Expired ${data.expired} subscription(s)`, data });
  })
);

export default router;

