import { toIso } from "./common.js";

export function toAuthSessionDto({ user, role, customerProfile, expertProfile, gates }) {
  return {
    userId: user.id,
    role,
    email: user.email,
    phone: user.phone,
    hasCustomerProfile: Boolean(customerProfile),
    hasExpertProfile: Boolean(expertProfile),
    gates: {
      emailVerified: Boolean(user.emailVerifiedAt),
      phoneVerified: Boolean(user.phoneVerifiedAt),
      expertVerificationStatus: expertProfile?.verificationStatus ?? null,
      expertSubscriptionActive: gates?.expertSubscriptionActive ?? false,
      onboardingComplete: Boolean(expertProfile?.onboardingCompletedAt),
    },
  };
}

export function toAuthTokensDto({ accessToken, refreshToken, expiresIn, session }) {
  return {
    accessToken,
    refreshToken,
    expiresIn,
    session,
  };
}

export function toCheckAvailabilityDto({ emailAvailable, phoneAvailable }) {
  return {
    ...(emailAvailable !== undefined ? { emailAvailable } : {}),
    ...(phoneAvailable !== undefined ? { phoneAvailable } : {}),
  };
}
