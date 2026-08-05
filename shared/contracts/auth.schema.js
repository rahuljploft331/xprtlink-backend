import { z } from "zod";

export const sessionRoleSchema = z.enum(["customer", "expert"]);

export const sessionProfileGatesSchema = z.object({
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  expertVerificationStatus: z.string().nullable().optional(),
  expertSubscriptionActive: z.boolean().optional(),
  onboardingComplete: z.boolean().optional(),
});

export const authSessionDtoSchema = z.object({
  userId: z.string().uuid(),
  role: sessionRoleSchema,
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  hasCustomerProfile: z.boolean(),
  hasExpertProfile: z.boolean(),
  gates: sessionProfileGatesSchema,
});

export const authTokensDtoSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  session: authSessionDtoSchema,
});

export const registerRequestSchema = z.object({
  role: sessionRoleSchema,
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string().min(8),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
});

export const loginRequestSchema = z.object({
  role: sessionRoleSchema,
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string().min(1),
});

export const otpSendRequestSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  purpose: z.enum(["register", "reset_password", "verify_email", "verify_phone"]),
});

export const otpVerifyRequestSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  code: z.string().min(4).max(8),
  purpose: z.enum(["register", "reset_password", "verify_email", "verify_phone"]),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  code: z.string().min(4).max(8),
  newPassword: z.string().min(8),
});

export const passwordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const checkAvailabilityDtoSchema = z.object({
  emailAvailable: z.boolean().optional(),
  phoneAvailable: z.boolean().optional(),
});
