import rateLimit from "express-rate-limit";
import { getConfig } from "../config/loadEnv.js";

/**
 * Creates a rate limiter middleware instance.
 * @param {Object} [options]
 * @param {number} [options.windowMs] - Time window in milliseconds (default from RATE_LIMIT_WINDOW_MS or 15 mins)
 * @param {number} [options.max] - Max requests allowed per IP per window (default from RATE_LIMIT_MAX or 100)
 * @param {string|Object} [options.message] - Custom message or JSON payload when rate limit is exceeded
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter(options = {}) {
  const config = getConfig();

  const windowMs = options.windowMs ?? config.rateLimitWindowMs ?? 15 * 60 * 1000;
  const max = options.max ?? config.rateLimitMax ?? 100;
  const message = options.message ?? {
    success: false,
    message: "Too many requests from this IP, please try again later.",
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      details: `Limit of ${max} requests per ${Math.round(windowMs / 1000 / 60)} minute(s) exceeded.`,
    },
  };

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message,
    ...options,
  });
}

/**
 * Default global rate limiter middleware based on RATE_LIMIT_WINDOW_MS & RATE_LIMIT_MAX
 */
export const defaultRateLimiter = createRateLimiter();

/**
 * Strict rate limiter for authentication and sensitive operations (login, register, OTP)
 */
export const authRateLimiter = createRateLimiter({
  windowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_AUTH_MAX || 10),
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
    error: {
      code: "AUTH_RATE_LIMIT_EXCEEDED",
      details: "Too many login or OTP verification requests from this IP address.",
    },
  },
});

/**
 * Ultra-strict limiter for OTP send / resend endpoints.
 * These trigger real email / SMS sends (SendGrid cost + spam risk).
 * 5 requests per IP per hour.
 */
export const otpRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number(process.env.RATE_LIMIT_OTP_MAX || 5),
  message: {
    success: false,
    message: "Too many OTP requests. Please wait before requesting a new code.",
    error: {
      code: "OTP_RATE_LIMIT_EXCEEDED",
      details: "Maximum OTP send attempts reached. Please try again in an hour.",
    },
  },
});

/**
 * Strict limiter for password reset endpoint.
 * 5 requests per IP per 15 minutes.
 */
export const passwordRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PASSWORD_MAX || 5),
  message: {
    success: false,
    message: "Too many password reset attempts. Please try again later.",
    error: {
      code: "PASSWORD_RATE_LIMIT_EXCEEDED",
      details: "Maximum password reset attempts reached.",
    },
  },
});
