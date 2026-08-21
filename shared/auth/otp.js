import crypto from "crypto";
import { getDb } from "../db/getClient.js";
import { hashToken, verifyTokenHash } from "./password.js";
import { deliverOtp, getOtpConfig } from "./otpDelivery.js";
import { badRequest } from "../utils/errors.js";

export function generateOtpCode() {
  if (
    process.env.OTP_ENABLE_HARDCODE === "true" &&
    process.env.NODE_ENV !== "production" &&
    process.env.OTP_HARDCODE_CODE
  ) {
    return process.env.OTP_HARDCODE_CODE;
  }
  return String(crypto.randomInt(100000, 999999));
}

/**
 * Revoke unconsumed OTP challenges for the same identifier + purpose.
 */
export async function revokePendingOtpChallenges({ email, phone, purpose, userId }) {
  const db = getDb();
  await db.otpChallenge.updateMany({
    where: {
      purpose,
      consumedAt: null,
      ...(userId ? { userId } : {}),
      ...(email ? { email } : phone ? { phone } : {}),
    },
    data: { consumedAt: new Date() },
  });
}

/**
 * Enforce resend cooldown — throws if a challenge was sent too recently.
 */
export async function assertOtpResendAllowed({ email, phone, purpose }) {
  const { resendCooldownMs } = getOtpConfig();
  const latest = await getDb().otpChallenge.findFirst({
    where: {
      purpose,
      ...(email ? { email } : { phone }),
    },
    orderBy: { createdAt: "desc" },
  });

  if (!latest) return;

  const elapsed = Date.now() - latest.createdAt.getTime();
  if (elapsed < resendCooldownMs) {
    const waitSeconds = Math.ceil((resendCooldownMs - elapsed) / 1000);
    throw badRequest(
      `Please wait ${waitSeconds} seconds before requesting a new code.`,
      "OTP_RESEND_COOLDOWN",
      email ? "email" : "phone"
    );
  }
}

export async function findValidOtpChallenge({ email, phone, purpose }) {
  const challenge = await getDb().otpChallenge.findFirst({
    where: {
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      ...(email ? { email } : { phone }),
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    throw badRequest("OTP expired or not found", "OTP_EXPIRED", email ? "email" : "phone");
  }

  if (challenge.blockedUntil && challenge.blockedUntil > new Date()) {
    throw badRequest(
      "Too many incorrect attempts. Please try again later.",
      "OTP_MAX_ATTEMPTS",
      email ? "email" : "phone"
    );
  }

  return challenge;
}

/**
 * Verify OTP code; increments attempt count and may block on repeated failures.
 */
export async function verifyOtpCode(challenge, code) {
  const { maxAttempts, blockDurationMs } = getOtpConfig();
  let valid = false;

  if (challenge.codeHash === "TWILIO_VERIFY" && challenge.phone) {
    if (
      process.env.OTP_ENABLE_HARDCODE === "true" &&
      process.env.NODE_ENV !== "production" &&
      process.env.OTP_HARDCODE_CODE === code
    ) {
      valid = true;
    } else {
      const { verifySmsOtp } = await import("./otpDelivery.js");
      valid = await verifySmsOtp({ phone: challenge.phone, code });
    }
  } else {
    valid = await verifyTokenHash(code, challenge.codeHash);
  }

  if (valid) return true;

  const nextAttempts = challenge.attemptCount + 1;
  const blockedUntil =
    nextAttempts >= maxAttempts ? new Date(Date.now() + blockDurationMs) : null;

  await getDb().otpChallenge.update({
    where: { id: challenge.id },
    data: {
      attemptCount: nextAttempts,
      ...(blockedUntil ? { blockedUntil } : {}),
    },
  });

  if (blockedUntil) {
    throw badRequest(
      "Too many incorrect attempts. Please try again later.",
      "OTP_MAX_ATTEMPTS",
      challenge.email ? "email" : "phone"
    );
  }

  throw badRequest("The verification code entered is incorrect.", "INVALID_OTP", "code");
}

/**
 * Create OTP challenge, deliver code, return metadata for API response.
 */
export async function createAndDeliverOtp({
  email,
  phone,
  purpose,
  channel,
  userId,
  registrationData,
}) {
  const { ttlMs } = getOtpConfig();

  await assertOtpResendAllowed({ email, phone, purpose });
  await revokePendingOtpChallenges({ email, phone, purpose, userId });

  const resolvedChannel = channel ?? (phone ? "phone" : "email");
  let code = null;
  let codeHash = "TWILIO_VERIFY";

  if (resolvedChannel === "phone") {
    await deliverOtp({ email, phone, code: null, purpose, channel: resolvedChannel });
  } else {
    code = generateOtpCode();
    codeHash = await hashToken(code);
    await deliverOtp({ email, phone, code, purpose, channel: resolvedChannel });
  }

  await getDb().otpChallenge.create({
    data: {
      userId: userId ?? null,
      email: email ?? null,
      phone: phone ?? null,
      codeHash,
      purpose,
      registrationData: registrationData ?? null,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  return {
    sent: true,
    expiresInSeconds: ttlMs / 1000,
    channel: resolvedChannel,
  };
}
