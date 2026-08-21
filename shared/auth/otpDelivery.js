import { getSecretSync } from "../config/secrets.js";
import { badRequest } from "../utils/errors.js";
import { sendEmail } from "../lib/email.js";

const OTP_PURPOSE_LABELS = {
  register: "account verification",
  reset_password: "password reset",
  verify_email: "email verification",
  verify_phone: "phone verification",
};

function isDevFallbackEnabled() {
  return process.env.NODE_ENV !== "production";
}

function logDevOtp(channel, destination, code, purpose) {
  if (isDevFallbackEnabled()) {
    console.log(`[otp] ${purpose} code via ${channel} to ${destination}: ${code}`);
  }
}

async function sendEmailOtp({ email, code, purpose }) {
  if (!getSecretSync("SENDGRID_API_KEY")) {
    logDevOtp("email", email, code, purpose);
    if (isDevFallbackEnabled()) return;
    throw badRequest(
      "Unable to send verification code. Please try again.",
      "OTP_DELIVERY_FAILED",
      "email"
    );
  }

  const label = OTP_PURPOSE_LABELS[purpose] ?? "verification";

  await sendEmail({
    to: email,
    subject: `Your XprtLink ${label} code`,
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
  });
}

async function sendSmsOtp({ phone, purpose }) {
  const accountSid = getSecretSync("TWILIO_ACCOUNT_SID");
  const authToken = getSecretSync("TWILIO_AUTH_TOKEN");
  const verifyServiceSid = getSecretSync("TWILIO_VERIFY_SERVICE_SID");

  if (!accountSid || !authToken || !verifyServiceSid) {
    if (isDevFallbackEnabled()) {
      const devCode = process.env.OTP_ENABLE_HARDCODE === "true" ? process.env.OTP_HARDCODE_CODE : "<twilio-verify-simulated>";
      console.log(`[otp] ${purpose} verify SMS via Twilio to ${phone}: ${devCode}`);
      return;
    }
    throw badRequest(
      "Unable to send verification code. Please try again.",
      "OTP_DELIVERY_FAILED",
      "phone"
    );
  }

  const twilio = await import("twilio");
  const client = twilio.default(accountSid, authToken);

  await client.verify.v2.services(verifyServiceSid).verifications.create({
    to: phone,
    channel: "sms",
  });
}

export async function verifySmsOtp({ phone, code }) {
  const accountSid = getSecretSync("TWILIO_ACCOUNT_SID");
  const authToken = getSecretSync("TWILIO_AUTH_TOKEN");
  const verifyServiceSid = getSecretSync("TWILIO_VERIFY_SERVICE_SID");

  if (!accountSid || !authToken || !verifyServiceSid) {
    throw badRequest("Twilio Verify configuration is missing.", "OTP_CONFIG_ERROR");
  }

  const twilio = await import("twilio");
  const client = twilio.default(accountSid, authToken);

  try {
    const verificationCheck = await client.verify.v2.services(verifyServiceSid).verificationChecks.create({
      to: phone,
      code,
    });
    return verificationCheck.status === "approved";
  } catch (err) {
    return false;
  }
}

/**
 * Deliver a 6-digit OTP via email or SMS.
 * Falls back to console logging in non-production when providers are not configured.
 */
export async function deliverOtp({ email, phone, code, purpose, channel }) {
  const resolvedChannel = channel ?? (phone ? "phone" : "email");

  if (resolvedChannel === "phone") {
    if (!phone) throw badRequest("Phone is required for SMS OTP", "VALIDATION_ERROR", "phone");
    await sendSmsOtp({ phone, purpose });
    return "phone";
  }

  if (!email) throw badRequest("Email is required for email OTP", "VALIDATION_ERROR", "email");
  await sendEmailOtp({ email, code, purpose });
  return "email";
}

export function getOtpConfig() {
  return {
    ttlMs: parseInt(getSecretSync("OTP_TTL_MS", String(10 * 60 * 1000)), 10),
    maxAttempts: parseInt(getSecretSync("OTP_MAX_ATTEMPTS", "5"), 10),
    resendCooldownMs: parseInt(getSecretSync("OTP_RESEND_COOLDOWN_SECONDS", "60"), 10) * 1000,
    blockDurationMs:
      parseInt(getSecretSync("OTP_BLOCK_DURATION_SECONDS", "900"), 10) * 1000,
  };
}
