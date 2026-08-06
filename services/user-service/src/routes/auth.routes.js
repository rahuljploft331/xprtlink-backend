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
} from "@xprtlink/shared/contracts";
import * as svc from "../services/userService.js";

const router = Router();

router.get(
  "/session",
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.getSession(req);
    return ResponseFormatter.success(res, { message: "Session valid", data });
  })
);

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = registerRequestSchema.parse(req.body);
    const data = await svc.register(body);
    return ResponseFormatter.success(res, { message: "Registered", data, status: 201 });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginRequestSchema.parse(req.body);
    const data = await svc.login(body);
    return ResponseFormatter.success(res, { message: "Logged in", data });
  })
);

router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    await svc.logout(req.body.refreshToken);
    return ResponseFormatter.success(res, { message: "Logged out", data: null });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const data = await svc.refresh(req.body.refreshToken, req.body.role);
    return ResponseFormatter.success(res, { message: "Token refreshed", data });
  })
);

router.post(
  "/otp/send",
  asyncHandler(async (req, res) => {
    const body = otpSendRequestSchema.parse(req.body);
    const data = await svc.sendOtp(body);
    return ResponseFormatter.success(res, { message: "OTP sent", data });
  })
);

router.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    const body = otpVerifyRequestSchema.parse(req.body);
    const data = await svc.verifyOtp(body);
    return ResponseFormatter.success(res, { message: "OTP verified", data });
  })
);

router.post(
  "/otp/resend",
  asyncHandler(async (req, res) => {
    const body = otpSendRequestSchema.parse(req.body);
    const data = await svc.resendOtp(body);
    return ResponseFormatter.success(res, { message: "OTP resent", data });
  })
);

router.post(
  "/password/forgot",
  asyncHandler(async (req, res) => {
    const body = otpSendRequestSchema.parse({ ...req.body, purpose: "reset_password" });
    const data = await svc.forgotPassword(body);
    return ResponseFormatter.success(res, { message: "Reset code sent", data });
  })
);

router.post(
  "/password/reset",
  asyncHandler(async (req, res) => {
    const body = passwordResetRequestSchema.parse(req.body);
    const data = await svc.resetPassword(body);
    return ResponseFormatter.success(res, { message: "Password reset", data });
  })
);

router.post(
  "/password/change",
  authenticate,
  asyncHandler(async (req, res) => {
    const body = passwordChangeRequestSchema.parse(req.body);
    const data = await svc.changePassword(req.auth.userId, body);
    return ResponseFormatter.success(res, { message: "Password changed", data });
  })
);

router.get(
  "/check-availability",
  asyncHandler(async (req, res) => {
    const data = await svc.checkAvailability(req.query);
    return ResponseFormatter.success(res, { message: "Availability checked", data });
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
    return ResponseFormatter.success(res, { message: "Verification code sent", data });
  })
);

export default router;
