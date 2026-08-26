import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import {
  loginRequestSchema,
  registerRequestSchema,
  otpSendRequestSchema,
  otpVerifyRequestSchema,
  passwordResetRequestSchema,
  passwordChangeRequestSchema,
  socialLoginRequestSchema,
  socialCompleteRequestSchema,
  refreshRequestSchema,
  phoneChangeRequestSchema,
  phoneChangeVerifySchema,
} from "@xprtlink/shared/contracts";
import * as svc from "../services/userService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

router.get(
  "/session",
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getSession(req);
    return ResponseFormatter.success(res, { message: getMessage("sessionValid"), data });
  })
);

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = registerRequestSchema.parse(req.body);
    const data = await svc.register(body);
    return ResponseFormatter.success(res, { message: getMessage("registered"), data, status: 201 });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginRequestSchema.parse(req.body);
    const data = await svc.login(body);
    return ResponseFormatter.success(res, { message: getMessage("loggedIn"), data });
  })
);

router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    await svc.logout(req.auth.userId, req.body.refreshToken);
    return ResponseFormatter.success(res, { message: getMessage("loggedOut"), data: null });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const body = refreshRequestSchema.parse(req.body);
    const data = await svc.refresh(body.refreshToken, body.role);
    return ResponseFormatter.success(res, { message: getMessage("tokenRefreshed"), data });
  })
);

router.post(
  "/phone/change/request",
  authenticate,
  asyncHandler(async (req, res) => {
    const body = phoneChangeRequestSchema.parse(req.body);
    const data = await svc.requestPhoneChange(req.auth.userId, body);
    return ResponseFormatter.success(res, { message: getMessage("phoneChangeCodeSent"), data });
  })
);

router.post(
  "/phone/change/verify",
  authenticate,
  asyncHandler(async (req, res) => {
    const body = phoneChangeVerifySchema.parse(req.body);
    const data = await svc.verifyPhoneChange(req.auth.userId, body);
    return ResponseFormatter.success(res, { message: getMessage("phoneChanged"), data });
  })
);

router.post(
  "/otp/send",
  asyncHandler(async (req, res) => {
    const body = otpSendRequestSchema.parse(req.body);
    const data = await svc.sendOtp(body);
    return ResponseFormatter.success(res, { message: getMessage("otpSent"), data });
  })
);

router.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    const body = otpVerifyRequestSchema.parse(req.body);
    const data = await svc.verifyOtp(body);
    return ResponseFormatter.success(res, { message: getMessage("otpVerified"), data });
  })
);

router.post(
  "/otp/resend",
  asyncHandler(async (req, res) => {
    const body = otpSendRequestSchema.parse(req.body);
    const data = await svc.resendOtp(body);
    return ResponseFormatter.success(res, { message: getMessage("otpResent"), data });
  })
);

router.post(
  "/password/forgot",
  asyncHandler(async (req, res) => {
    const body = otpSendRequestSchema.parse({ ...req.body, purpose: "reset_password" });
    const data = await svc.forgotPassword(body);
    return ResponseFormatter.success(res, { message: getMessage("resetCodeSent"), data });
  })
);

router.post(
  "/password/reset",
  asyncHandler(async (req, res) => {
    const body = passwordResetRequestSchema.parse(req.body);
    const data = await svc.resetPassword(body);
    return ResponseFormatter.success(res, { message: getMessage("passwordReset"), data });
  })
);

router.post(
  "/password/change",
  authenticate,
  asyncHandler(async (req, res) => {
    const body = passwordChangeRequestSchema.parse(req.body);
    const data = await svc.changePassword(req.auth.userId, body);
    return ResponseFormatter.success(res, { message: getMessage("passwordChanged"), data });
  })
);

router.get(
  "/check-availability",
  asyncHandler(async (req, res) => {
    const data = await svc.checkAvailability(req.query);
    return ResponseFormatter.success(res, { message: getMessage("availabilityChecked"), data });
  })
);

router.post(
  "/social",
  asyncHandler(async (req, res) => {
    const body = socialLoginRequestSchema.parse(req.body);
    const data = await svc.socialLogin(body);
    const message = data.needsProfileCompletion
      ? "Profile completion required"
      : "Social login successful";
    return ResponseFormatter.success(res, { message, data });
  })
);

router.post(
  "/social/complete",
  asyncHandler(async (req, res) => {
    const body = socialCompleteRequestSchema.parse(req.body);
    const data = await svc.socialComplete(body);
    return ResponseFormatter.success(res, { message: getMessage("verificationCodeSent"), data });
  })
);

export default router;
