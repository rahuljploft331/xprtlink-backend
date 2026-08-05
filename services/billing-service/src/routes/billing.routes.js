import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate, requireRole } from "@xprtlink/shared/middleware/auth.js";
import {
  addPaymentMethodRequestSchema,
  payConsultationRequestSchema,
  subscribeRequestSchema,
} from "@xprtlink/shared/contracts";
import * as svc from "../services/billingService.js";

const router = Router();

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
  "/consultations/:id/pay",
  requireRole("customer"),
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

router.get(
  "/earnings",
  requireRole("expert"),
  asyncHandler(async (req, res) => {
    const data = await svc.getEarnings(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: "Earnings", ...data });
  })
);

export default router;
