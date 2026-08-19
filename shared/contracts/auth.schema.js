import { z } from "zod";

export const sessionRoleSchema = z.enum(["customer", "expert"]);

/** E.164 phone format (e.g. +14155552671) */
export const e164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone must be in E.164 format (e.g. +14155552671)");

/** MFS password policy: min 8, upper, lower, digit, special */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one numeric digit")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

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

export const registerRequestSchema = z
  .object({
    role: sessionRoleSchema,
    email: z.string().email(),
    phone: e164PhoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    termsAccepted: z.literal(true, {
      errorMap: () => ({ message: "You must accept the Terms of Service and Privacy Policy" }),
    }),
    /** OTP delivery channel for step 2. Defaults to phone on the server. */
    otpChannel: z.enum(["email", "phone"]).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginRequestSchema = z
  .object({
    role: sessionRoleSchema,
    email: z.string().email().optional(),
    phone: e164PhoneSchema.optional(),
    password: z.string().optional(),
  })
  .refine((data) => data.email || data.phone, {
    message: "Email or phone is required",
    path: ["email"],
  })
  .refine((data) => {
    if (data.email && (!data.password || data.password.length === 0)) return false;
    return true;
  }, {
    message: "Password is required for email login",
    path: ["password"],
  });

export const otpSendRequestSchema = z
  .object({
    email: z.string().email().optional(),
    phone: e164PhoneSchema.optional(),
    purpose: z.enum(["register", "login", "reset_password", "verify_email", "verify_phone"]),
  })
  .refine((data) => data.email || data.phone, {
    message: "Email or phone is required",
    path: ["email"],
  });

export const otpVerifyRequestSchema = z
  .object({
    email: z.string().email().optional(),
    phone: e164PhoneSchema.optional(),
    code: z.string().regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
    purpose: z.enum(["register", "login", "reset_password", "verify_email", "verify_phone"]),
  })
  .refine((data) => data.email || data.phone, {
    message: "Email or phone is required",
    path: ["email"],
  });

export const passwordResetRequestSchema = z
  .object({
    email: z.string().email().optional(),
    phone: e164PhoneSchema.optional(),
    code: z.string().regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.email || data.phone, {
    message: "Email or phone is required",
    path: ["email"],
  });

export const passwordChangeRequestSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const socialProviderSchema = z.enum(["google", "apple"]);

export const socialLoginRequestSchema = z.object({
  provider: socialProviderSchema,
  idToken: z.string().min(1),
  role: sessionRoleSchema,
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
});

export const socialCompleteRequestSchema = z.object({
  completionToken: z.string().min(1),
  phone: e164PhoneSchema,
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms of Service and Privacy Policy" }),
  }),
});

export const registerOtpSentDtoSchema = z.object({
  sent: z.literal(true),
  expiresInSeconds: z.number().int().positive(),
  channel: z.enum(["email", "phone"]).optional(),
});

export const socialProfileCompletionDtoSchema = z.object({
  needsProfileCompletion: z.literal(true),
  missing: z.array(z.enum(["phone"])),
  completionToken: z.string(),
});

export const checkAvailabilityDtoSchema = z.object({
  emailAvailable: z.boolean().optional(),
  phoneAvailable: z.boolean().optional(),
});
