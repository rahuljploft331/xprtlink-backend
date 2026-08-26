import { getDb } from "@xprtlink/shared/db";
import { issueTokens, loadUserContext, revokeRefreshToken, lookupRefreshToken, revokeAllUserSessions } from "@xprtlink/shared/auth/tokens.js";
import { hashPassword, verifyPassword, verifyTokenHash } from "@xprtlink/shared/auth/password.js";
import {
  createAndDeliverOtp,
  findValidOtpChallenge,
  verifyOtpCode,
} from "@xprtlink/shared/auth/otp.js";
import { getOtpConfig } from "@xprtlink/shared/auth/otpDelivery.js";
import { verifyFirebaseIdToken, isFirebaseConfigured } from "@xprtlink/shared/auth/firebaseAdmin.js";
import { signCompletionToken, verifyCompletionToken } from "@xprtlink/shared/auth/jwt.js";
import { toAuthSessionDto } from "@xprtlink/shared/mappers/auth.mapper.js";
import { toCustomerMeDto } from "@xprtlink/shared/mappers/customer.mapper.js";
import { badRequest, conflict, notFound, unauthorized, forbidden } from "@xprtlink/shared/utils/errors.js";
import { parsePagination, paginatedResult } from "@xprtlink/shared/utils/pagination.js";

// ─── Session ──────────────────────────────────────────────────────────────────

export async function getSession(req) {
  const user = await loadUserContext(req.auth.userId);
  if (!user || user.status !== "active") throw unauthorized("Session invalid");

  const role = req.auth.role;
  const subscriptionActive = Boolean(user.expertProfile?.subscriptions?.length);

  return toAuthSessionDto({
    user,
    role,
    customerProfile: user.customerProfile,
    expertProfile: user.expertProfile,
    gates: { expertSubscriptionActive: subscriptionActive },
  });
}

// ─── Registration (2-step) ────────────────────────────────────────────────────
//
// Step 1 → POST /auth/register
//   Creates User with status=pending_verification (email + phone required).
//   Sends OTP to phone by default (or email if otpChannel=email).
//
// Step 2 → POST /auth/otp/verify  { purpose: "register" }
//   Verifies OTP, creates profile, activates account, issues tokens.

const claimedAvailabilityFilter = {
  status: { notIn: ["pending_verification", "deleted"] },
  deletedAt: null,
};

async function assertIdentifierAvailable({ email, phone, excludeUserId }) {
  const db = getDb();
  if (email) {
    const row = await db.user.findFirst({
      where: {
        email,
        ...claimedAvailabilityFilter,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    });
    if (row) {
      throw conflict("An account with this email already exists.", "EMAIL_TAKEN");
    }
  }
  if (phone) {
    const row = await db.user.findFirst({
      where: {
        phone,
        ...claimedAvailabilityFilter,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    });
    if (row) {
      throw conflict("This mobile number is already in use.", "PHONE_TAKEN");
    }
  }
}

async function createProfileForRole(
  tx,
  userId,
  role,
  firstName,
  lastName,
  { categoryId, avatarMediaId } = {}
) {
  if (role === "customer") {
    return tx.user.update({
      where: { id: userId },
      data: {
        customerProfile: {
          create: { firstName, lastName, ...(avatarMediaId ? { avatarMediaId } : {}) },
        },
      },
      include: profileInclude(),
    });
  }

  // Use the provided categoryId if valid, otherwise fall back to the first active category
  let resolvedCategoryId = categoryId;
  if (resolvedCategoryId) {
    const cat = await tx.category.findFirst({
      where: { id: resolvedCategoryId, isActive: true },
    });
    if (!cat) resolvedCategoryId = null; // invalid/inactive — fall back
  }
  if (!resolvedCategoryId) {
    const category = await tx.category.findFirst({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    if (!category) throw badRequest("No categories configured");
    resolvedCategoryId = category.id;
  }

  return tx.user.update({
    where: { id: userId },
    data: {
      expertProfile: {
        create: {
          firstName,
          lastName,
          categoryId: resolvedCategoryId,
          consultationRateCents: 0,
          ...(avatarMediaId ? { avatarMediaId } : {}),
          settings: { create: { preferences: {} } },
        },
      },
    },
    include: profileInclude(),
  });
}

function profileInclude() {
  return {
    customerProfile: true,
    expertProfile: {
      include: { subscriptions: { where: { status: "active" }, take: 1 } },
    },
  };
}

async function ensureProfileForRole(user, role, firstName, lastName) {
  const hasProfile =
    role === "customer" ? Boolean(user.customerProfile) : Boolean(user.expertProfile);
  if (hasProfile) return user;

  const resolvedFirst = firstName ?? user.customerProfile?.firstName ?? user.expertProfile?.firstName ?? "User";
  const resolvedLast = lastName ?? user.customerProfile?.lastName ?? user.expertProfile?.lastName ?? "";

  return createProfileForRole(getDb(), user.id, role, resolvedFirst, resolvedLast);
}

export async function register(body) {
  const {
    role,
    email,
    phone,
    password,
    firstName,
    lastName,
    otpChannel = "phone",
    categoryId,
    avatarMediaId,
  } = body;

  // Pre-flight availability check (fast-fails common case; real enforcement is inside the transaction)
  await assertIdentifierAvailable({ email, phone });

  // Require phone to be pre-verified via OTP (consumed verify_phone challenge within 30 min)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const phoneVerification = await getDb().otpChallenge.findFirst({
    where: {
      phone,
      purpose: "verify_phone",
      consumedAt: { not: null, gte: thirtyMinAgo },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!phoneVerification) {
    throw badRequest(
      "Phone number must be verified before registration. Please verify your phone first.",
      "PHONE_NOT_VERIFIED",
      "phone"
    );
  }

  const db = getDb();
  const passwordHash = await hashPassword(password);
  const termsAcceptedAt = new Date();

  let userId;

  try {
    userId = await db.$transaction(async (tx) => {
      // Re-check availability inside the transaction to close the TOCTOU window.
      // The partial unique indexes (added in Phase 1) provide the ultimate guard,
      // but this gives a clearer error message before hitting the constraint.
      if (email) {
        const dup = await tx.user.findFirst({
          where: { email, ...claimedAvailabilityFilter },
        });
        if (dup) throw conflict("An account with this email already exists.", "EMAIL_TAKEN");
      }
      if (phone) {
        const dup = await tx.user.findFirst({
          where: { phone, ...claimedAvailabilityFilter },
        });
        if (dup) throw conflict("This mobile number is already in use.", "PHONE_TAKEN");
      }

      // Look for a pending user that matches BOTH identifiers (not just one).
      // This prevents cross-contamination where a pending user with matching email
      // but different phone gets its phone overwritten.
      const pendingWhere = { status: "pending_verification" };
      if (email && phone) {
        pendingWhere.email = email;
        pendingWhere.phone = phone;
      } else if (email) {
        pendingWhere.email = email;
      } else if (phone) {
        pendingWhere.phone = phone;
      }

      const pending = await tx.user.findFirst({ where: pendingWhere });

      if (pending) {
        await tx.user.update({
          where: { id: pending.id },
          data: { email, phone, passwordHash, termsAcceptedAt },
        });
        return pending.id;
      }

      const user = await tx.user.create({
        data: {
          email,
          phone,
          passwordHash,
          termsAcceptedAt,
          status: "pending_verification",
        },
      });
      return user.id;
    });
  } catch (err) {
    // Handle Prisma unique constraint violation (P2002) from the partial unique indexes
    if (err?.code === "P2002") {
      const field = err.meta?.target?.includes("email") ? "email" : "phone";
      throw conflict(
        field === "email"
          ? "An account with this email already exists."
          : "This mobile number is already in use.",
        field === "email" ? "EMAIL_TAKEN" : "PHONE_TAKEN"
      );
    }
    throw err;
  }

  return createAndDeliverOtp({
    email: otpChannel === "email" ? email : undefined,
    phone: otpChannel === "phone" ? phone : undefined,
    purpose: "register",
    channel: otpChannel,
    userId,
    registrationData: { role, firstName, lastName, otpChannel, categoryId, avatarMediaId },
  });
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(body) {
  const { role, email, phone, password } = body;
  if (!email && !phone) throw badRequest("Email or phone is required", "VALIDATION_ERROR", "email");

  const db = getDb();
  const user = await db.user.findFirst({
    where: email ? { email, deletedAt: null } : { phone, deletedAt: null },
    include: {
      customerProfile: true,
      expertProfile: { include: { subscriptions: { where: { status: "active" }, take: 1 } } },
    },
  });

  if (!user) {
    // M7: constant-time dummy compare to prevent timing-based email enumeration.
    // Without this, nonexistent emails return ~0ms while valid ones take ~100ms (bcrypt).
    await verifyPassword("__dummy_password_that_never_matches__", "$2b$10$abcdefghijklmnopqrstuvuXzGO7fMC7VYzWH4HmM0vXcB9tBr7bq");
    throw unauthorized("Invalid credentials");
  }

  // Give a clear, actionable error instead of a generic 401
  if (user.status === "pending_verification") {
    throw forbidden(
      "Account not verified. Please check your email/phone for the verification code.",
      "EMAIL_NOT_VERIFIED"
    );
  }

  if (user.status !== "active") throw unauthorized("Invalid credentials");

  if (phone) {
    const otpResult = await createAndDeliverOtp({
      phone,
      purpose: "login",
      channel: "phone",
      userId: user.id,
      registrationData: { role },
    });
    return { needsOtp: true, ...otpResult };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw unauthorized("Invalid credentials");

  const tokens = await issueTokens(user, role);
  if (!tokens) throw badRequest(`No ${role} profile on this account`, "PROFILE_MISSING");
  return tokens;
}

// ─── Logout & Token Refresh ───────────────────────────────────────────────────

export async function logout(userId, refreshToken) {
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  } else {
    // No specific token provided — revoke ALL sessions for this user as a safety measure
    await revokeAllUserSessions(userId);
  }
}

export async function refresh(refreshToken, role) {
  if (!refreshToken) throw unauthorized("Refresh token required");

  // O(1) SHA-256 indexed lookup — no more linear scan of all active tokens
  const result = await lookupRefreshToken(refreshToken, role);
  if (!result) throw unauthorized("Invalid refresh token");

  const issued = await issueTokens(result.user, result.resolvedRole);
  if (!issued) throw unauthorized("Session invalid");
  return issued;
}

// ─── OTP ──────────────────────────────────────────────────────────────────────

export async function sendOtp(body) {
  const { email, phone, purpose } = body;
  if (!email && !phone) throw badRequest("Email or phone required");

  if (purpose === "register") {
    throw badRequest(
      "Use POST /auth/register to start the registration flow.",
      "USE_REGISTER_ENDPOINT"
    );
  }

  const channel = phone ? "phone" : "email";
  return createAndDeliverOtp({
    email,
    phone,
    purpose,
    channel,
  });
}

/**
 * Verify an OTP code.
 *
 * Purpose = "register":
 *   Atomically creates the user profile, activates the account, stamps
 *   emailVerifiedAt/phoneVerifiedAt, and returns full auth tokens.
 *   This is the completion step of the 2-step registration flow.
 *
 * Purpose = "verify_email" | "verify_phone":
 *   Stamps the corresponding verified timestamp on an already-active user.
 *   Returns { verified: true }.
 *
 * Purpose = "reset_password":
 *   Validates the code only (actual password update is in resetPassword()).
 *   Returns { verified: true }.
 */
export async function verifyOtp(body) {
  const { email, phone, code, purpose } = body;
  if (!email && !phone) throw badRequest("Email or phone required");

  const db = getDb();
  const challenge = await findValidOtpChallenge({ email, phone, purpose });
  await verifyOtpCode(challenge, code);

  if (purpose === "reset_password") {
    return { verified: true };
  }

  if (purpose === "login") {
    const user = await db.$transaction(async (tx) => {
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      return tx.user.findUnique({
        where: { id: challenge.userId },
        include: {
          customerProfile: true,
          expertProfile: { include: { subscriptions: { where: { status: "active" }, take: 1 } } },
        },
      });
    });

    const tokens = await issueTokens(user, challenge.registrationData?.role || "customer");
    if (!tokens) throw badRequest("Failed to create session");
    return tokens;
  }

  if (purpose === "register") {
    if (!challenge.registrationData || !challenge.userId) {
      throw badRequest(
        "Registration session expired. Please register again.",
        "REGISTRATION_EXPIRED"
      );
    }

    const { role, firstName, lastName, otpChannel, categoryId, avatarMediaId } =
      challenge.registrationData;

    // Validate the optional sign-up avatar: it must be a "ready" avatar asset
    // owned by the user completing registration. Invalid/foreign/unready ids are
    // ignored (profile is created without an avatar) rather than failing signup.
    let resolvedAvatarMediaId = null;
    if (avatarMediaId) {
      const media = await db.mediaAsset.findFirst({
        where: {
          id: avatarMediaId,
          ownerUserId: challenge.userId,
          purpose: "avatar",
          status: "ready",
        },
        select: { id: true },
      });
      if (media) resolvedAvatarMediaId = media.id;
    }

    // C1: Only stamp the channel that was actually verified.
    // The other channel remains null until it is separately verified.
    const verifiedViaPhone = otpChannel === "phone" || (!otpChannel && challenge.phone);

    // Check if phone was pre-verified before registration (signup screen flow).
    // When otpChannel=email, the register challenge won't have phone — look it up from the User row.
    let phonePreVerified = false;
    if (!verifiedViaPhone) {
      const pendingUser = await db.user.findUnique({ where: { id: challenge.userId }, select: { phone: true } });
      if (pendingUser?.phone) {
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
        const consumed = await db.otpChallenge.findFirst({
          where: {
            phone: pendingUser.phone,
            purpose: "verify_phone",
            consumedAt: { not: null, gte: thirtyMinAgo },
          },
          orderBy: { createdAt: "desc" },
        });
        phonePreVerified = Boolean(consumed);
      }
    }

    const user = await db.$transaction(async (tx) => {
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });

      await tx.user.update({
        where: { id: challenge.userId },
        data: {
          status: "active",
          ...(verifiedViaPhone || phonePreVerified
            ? { phoneVerifiedAt: new Date() }
            : {}),
          ...(!verifiedViaPhone
            ? { emailVerifiedAt: new Date() }
            : {}),
        },
      });

      return createProfileForRole(tx, challenge.userId, role, firstName, lastName, {
        categoryId,
        avatarMediaId: resolvedAvatarMediaId,
      });
    });

    const tokens = await issueTokens(user, role);
    if (!tokens) throw badRequest("Failed to create session");
    return tokens;
  }

  if (purpose === "verify_phone" && challenge.registrationData?.isSocialCompletion) {
    const { role, firstName, lastName } = challenge.registrationData;

    const user = await db.$transaction(async (tx) => {
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });

      await tx.user.update({
        where: { id: challenge.userId },
        data: {
          status: "active",
          phoneVerifiedAt: new Date(),
        },
      });

      return createProfileForRole(tx, challenge.userId, role, firstName, lastName);
    });

    const tokens = await issueTokens(user, role);
    if (!tokens) throw badRequest("Failed to create session");
    return tokens;
  }

  await db.$transaction([
    db.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    }),
    // Only stamp verified timestamps if the challenge is linked to an existing user
    // (pre-registration phone verification won't have a userId)
    ...(purpose === "verify_email" && challenge.userId
      ? [db.user.update({ where: { id: challenge.userId }, data: { emailVerifiedAt: new Date() } })]
      : []),
    ...(purpose === "verify_phone" && challenge.userId
      ? [db.user.update({ where: { id: challenge.userId }, data: { phoneVerifiedAt: new Date() } })]
      : []),
  ]);

  return { verified: true };
}

export async function resendOtp(body) {
  return sendOtp(body);
}

// ─── Password ─────────────────────────────────────────────────────────────────

export async function forgotPassword(body) {
  const { email, phone } = body;
  const db = getDb();

  // Check whether this email/phone actually belongs to an active account.
  // If not found, we silently return the same success-shaped response to
  // prevent user enumeration (attacker cannot tell if an email is registered).
  const user = await db.user.findFirst({
    where: {
      ...(email ? { email } : { phone }),
      deletedAt: null,
      status: { not: "pending_verification" },
    },
  });

  if (!user) {
    // Return a plausible response without sending anything or revealing the email isn't registered.
    // Use the real OTP TTL config so the response is indistinguishable from a genuine send.
    const { ttlMs } = getOtpConfig();
    return { sent: true, expiresInSeconds: ttlMs / 1000, channel: email ? "email" : "phone" };
  }

  return sendOtp({ ...body, purpose: "reset_password" });
}

export async function resetPassword(body) {
  const { email, phone, code, newPassword } = body;
  const challenge = await findValidOtpChallenge({ email, phone, purpose: "reset_password" });
  await verifyOtpCode(challenge, code);

  const db = getDb();
  const user = await db.user.findFirst({
    where: email ? { email, deletedAt: null } : { phone, deletedAt: null },
  });
  if (!user) throw notFound("User not found");

  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
    db.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    }),
    // C3: Revoke ALL existing sessions so attacker is immediately locked out
    db.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  return { reset: true };
}

export async function changePassword(userId, body) {
  const { currentPassword, newPassword } = body;
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw badRequest("Current password is incorrect", "INVALID_CURRENT_PASSWORD", "currentPassword");

  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
    // C3: Revoke ALL existing sessions on password change
    db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  return { changed: true };
}

// ─── Change mobile number ─────────────────────────────────────────────────────
//
// Two-step, OTP-verified flow. Phone lives on the shared User row, so this works
// for both customers and experts (any authenticated user).
//
// Step 1 → POST /auth/phone/change/request  { phone }
//   Validates the new number is E.164, not already in use, and different from the
//   current one, then delivers an OTP to the NEW number (purpose=change_phone).
//
// Step 2 → POST /auth/phone/change/verify   { phone, code }
//   Verifies the OTP, updates user.phone, stamps phoneVerifiedAt, and revokes all
//   other sessions as a security measure (mirrors password reset/change).

export async function requestPhoneChange(userId, body) {
  const { phone } = body;
  const db = getDb();

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");
  if (user.status !== "active") throw unauthorized("Session invalid");

  if (user.phone && user.phone === phone) {
    throw badRequest("This is already your current mobile number.", "PHONE_UNCHANGED", "phone");
  }

  // Uniqueness — reject if another account already claims this number
  await assertIdentifierAvailable({ phone, excludeUserId: userId });

  // Reuse the verify_phone OTP purpose (the shared OtpPurpose enum). The challenge
  // is stamped with this userId so verifyPhoneChange can bind it to this account.
  return createAndDeliverOtp({
    phone,
    purpose: "verify_phone",
    channel: "phone",
    userId,
  });
}

export async function verifyPhoneChange(userId, body) {
  const { phone, code } = body;
  const db = getDb();

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");
  if (user.status !== "active") throw unauthorized("Session invalid");

  // Re-check availability at confirm time (guards against a race between step 1 and 2)
  await assertIdentifierAvailable({ phone, excludeUserId: userId });

  const challenge = await findValidOtpChallenge({ phone, purpose: "verify_phone" });

  // Bind the challenge to this user — a change-phone challenge is always stamped
  // with the requesting userId (registration pre-verify challenges have userId=null).
  if (challenge.userId !== userId) {
    throw badRequest("OTP expired or not found", "OTP_EXPIRED", "phone");
  }

  await verifyOtpCode(challenge, code);

  try {
    await db.$transaction([
      db.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      }),
      db.user.update({
        where: { id: userId },
        data: { phone, phoneVerifiedAt: new Date() },
      }),
      // Security: invalidate all other sessions on a mobile number change
      db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  } catch (err) {
    if (err?.code === "P2002") {
      throw conflict("This mobile number is already in use.", "PHONE_TAKEN");
    }
    throw err;
  }

  return { changed: true, phone };
}

// ─── Availability check ───────────────────────────────────────────────────────

export async function checkAvailability(query) {
  const db = getDb();
  const result = {};
  if (query.email) {
    const row = await db.user.findFirst({
      where: { email: query.email, ...claimedAvailabilityFilter },
    });
    result.emailAvailable = !row;
  }
  if (query.mobile || query.phone) {
    let phone = query.mobile || query.phone;
    // Normalize: URL query strings decode '+' as space — restore the leading '+'
    phone = phone.trim().replace(/^\s/, "+");
    if (!phone.startsWith("+")) phone = `+${phone}`;
    const row = await db.user.findFirst({
      where: { phone, ...claimedAvailabilityFilter },
    });
    result.phoneAvailable = !row;
  }
  return result;
}

export async function socialLogin(body) {
  const { idToken, role, firstName, lastName } = body;

  if (!isFirebaseConfigured()) {
    throw badRequest("Social login not configured", "NOT_IMPLEMENTED");
  }

  let decoded;
  try {
    decoded = await verifyFirebaseIdToken(idToken);
  } catch {
    throw unauthorized("Invalid social authentication token");
  }

  const firebaseUid = decoded.uid;
  const email = decoded.email ?? null;
  const db = getDb();
  const include = profileInclude();

  let user = await db.user.findUnique({ where: { firebaseUid }, include });

  if (!user && email) {
    user = await db.user.findFirst({ where: { email, deletedAt: null }, include });
    if (user) {
      user = await db.user.update({
        where: { id: user.id },
        data: { firebaseUid },
        include,
      });
    }
  }

  if (!user) {
    const nameParts = decoded.name?.trim().split(/\s+/) ?? [];
    user = await db.user.create({
      data: {
        email,
        firebaseUid,
        emailVerifiedAt: decoded.email_verified ? new Date() : null,
        status: "pending_verification",
      },
      include,
    });

    if (!user.phone) {
      return {
        needsProfileCompletion: true,
        missing: ["phone"],
        completionToken: signCompletionToken({
          sub: user.id,
          role,
          firstName: firstName ?? nameParts[0] ?? "User",
          lastName: lastName ?? nameParts.slice(1).join(" ") ?? "",
        }),
      };
    }
  }

  if (!user.phone) {
    return {
      needsProfileCompletion: true,
      missing: ["phone"],
      completionToken: signCompletionToken({
        sub: user.id,
        role,
        firstName: firstName ?? user.customerProfile?.firstName ?? user.expertProfile?.firstName ?? "User",
        lastName: lastName ?? user.customerProfile?.lastName ?? user.expertProfile?.lastName ?? "",
      }),
    };
  }

  if (user.status === "suspended" || user.status === "deleted") {
    throw forbidden("Your account has been suspended. Contact support.", "ACCOUNT_SUSPENDED");
  }

  user = await ensureProfileForRole(user, role, firstName, lastName);

  if (user.status === "pending_verification") {
    user = await db.user.update({
      where: { id: user.id },
      data: { status: "active" },
      include,
    });
  }

  const tokens = await issueTokens(user, role);
  if (!tokens) throw badRequest(`No ${role} profile on this account`, "PROFILE_MISSING");
  return tokens;
}

export async function socialComplete(body) {
  const { completionToken, phone } = body;

  let decoded;
  try {
    decoded = verifyCompletionToken(completionToken);
  } catch {
    throw badRequest("Profile completion session expired. Please sign in again.", "COMPLETION_EXPIRED");
  }

  const { sub: userId, role, firstName, lastName } = decoded;
  const db = getDb();

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");
  if (user.phone) {
    throw badRequest("Phone number already provided", "PHONE_ALREADY_SET", "phone");
  }

  await assertIdentifierAvailable({ phone, excludeUserId: userId });

  await db.user.update({
    where: { id: userId },
    data: { phone, termsAcceptedAt: new Date() },
  });

  return createAndDeliverOtp({
    phone,
    purpose: "verify_phone",
    channel: "phone",
    userId,
    registrationData: { role, firstName, lastName, isSocialCompletion: true },
  });
}

// ─── Stale-account cleanup ────────────────────────────────────────────────────

/**
 * Deletes pending_verification users created more than `maxAgeMinutes` ago
 * that have no attached profile (i.e. they never completed Step 2).
 *
 * Safe to call from a cron job or the admin "Maintenance" panel.
 * All related rows (refresh_tokens, otp_challenges) are cascade-deleted.
 *
 * @param {number} maxAgeMinutes  Default: 60. Ghost accounts older than this are removed.
 */
export async function cleanupStalePendingUsers({ maxAgeMinutes = 1440 } = {}) {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  // Find candidate users — pending_verification, no profile, created before cutoff
  const candidates = await db.user.findMany({
    where: {
      status: "pending_verification",
      createdAt: { lt: cutoff },
      customerProfile: null,
      expertProfile: null,
    },
    select: { id: true, email: true, phone: true },
    take: 500,
  });

  if (candidates.length === 0) return { deleted: 0 };

  const candidateIds = candidates.map((u) => u.id);

  // Exclude users who still have a live (non-expired, unconsumed) OTP challenge
  // so we don't delete someone who is in the middle of verifying
  const activeOtps = await db.otpChallenge.findMany({
    where: {
      userId: { in: candidateIds },
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { userId: true },
  });

  const protectedIds = new Set(activeOtps.map((o) => o.userId));
  const deletableIds = candidateIds.filter((id) => !protectedIds.has(id));

  if (deletableIds.length === 0) return { deleted: 0 };

  const result = await db.user.deleteMany({
    where: { id: { in: deletableIds } },
  });

  return { deleted: result.count };
}

// findValidOtp removed — use @xprtlink/shared/auth/otp.js

// ─── Customer profile & discoveries ──────────────────────────────────────────

export async function getCustomerMe(auth) {
  const user = await loadUserContext(auth.userId);
  if (!user?.customerProfile) throw notFound("Customer profile not found");
  return toCustomerMeDto({ profile: user.customerProfile, user });
}

export async function updateCustomerMe(auth, body) {
  const db = getDb();
  const profile = await db.customerProfile.findFirst({ where: { userId: auth.userId } });
  if (!profile) throw notFound("Customer profile not found");

  if (body.avatarMediaId) {
    const media = await db.mediaAsset.findFirst({
      where: { id: body.avatarMediaId, ownerUserId: auth.userId, status: "ready" }
    });
    if (!media) throw badRequest("Invalid or unready avatar media asset");
  }

  const updated = await db.customerProfile.update({
    where: { id: profile.id },
    data: {
      ...(body.firstName ? { firstName: body.firstName } : {}),
      ...(body.lastName ? { lastName: body.lastName } : {}),
      ...(body.avatarMediaId !== undefined ? { avatarMediaId: body.avatarMediaId } : {}),
    },
    include: { avatarMedia: true },
  });
  const user = await db.user.findUnique({ where: { id: auth.userId } });
  return toCustomerMeDto({ profile: updated, user });
}

export async function deleteCustomerAccount(auth) {
  await getDb().user.update({
    where: { id: auth.userId },
    data: { status: "deleted", deletedAt: new Date() },
  });
  return { deleted: true };
}

export async function getRecentlyViewed(auth, query) {
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();
  const [rows, total] = await Promise.all([
    db.customerRecentlyViewed.findMany({
      where: { customerProfileId: auth.customerProfileId },
      orderBy: { viewedAt: "desc" },
      skip,
      take: limit,
      include: { expert: { include: { category: true } } },
    }),
    db.customerRecentlyViewed.count({ where: { customerProfileId: auth.customerProfileId } }),
  ]);
  const items = rows.map((r) => ({
    id: r.expert.id,
    firstName: r.expert.firstName,
    lastName: r.expert.lastName,
    headline: r.expert.headline,
    categorySlug: r.expert.category.slug,
    categoryName: r.expert.category.name,
    consultationRate: r.expert.consultationRateCents / 100,
    currency: r.expert.currency,
    availabilityStatus: r.expert.availabilityStatus,
    rating: r.expert.ratingCount > 0 ? Number(r.expert.ratingAvg) : null,
    reviewCount: r.expert.ratingCount,
    viewedAt: r.viewedAt.toISOString(),
    savedAt: r.viewedAt.toISOString(),
  }));
  return paginatedResult(items, { page, limit, total });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Guard route path params before they reach Prisma. A malformed id would
// otherwise surface as an unhandled Prisma P2023 (invalid UUID) → 500.
function assertUuid(value, field = "expertId") {
  if (!value || !UUID_RE.test(value)) {
    throw badRequest("Invalid expert id", "VALIDATION_ERROR", field);
  }
}

export async function recordRecentlyViewed(auth, expertId) {
  assertUuid(expertId);
  const db = getDb();
  await db.customerRecentlyViewed.upsert({
    where: {
      customerProfileId_expertProfileId: {
        customerProfileId: auth.customerProfileId,
        expertProfileId: expertId,
      },
    },
    create: { customerProfileId: auth.customerProfileId, expertProfileId: expertId },
    update: { viewedAt: new Date() },
  });
  return { recorded: true };
}

export async function getSavedExperts(auth, query) {
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();
  const [rows, total] = await Promise.all([
    db.customerSavedExpert.findMany({
      where: { customerProfileId: auth.customerProfileId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { expert: { include: { category: true } } },
    }),
    db.customerSavedExpert.count({ where: { customerProfileId: auth.customerProfileId } }),
  ]);
  const items = rows.map((r) => ({
    id: r.expert.id,
    firstName: r.expert.firstName,
    lastName: r.expert.lastName,
    headline: r.expert.headline,
    categorySlug: r.expert.category.slug,
    categoryName: r.expert.category.name,
    consultationRate: r.expert.consultationRateCents / 100,
    currency: r.expert.currency,
    availabilityStatus: r.expert.availabilityStatus,
    rating: r.expert.ratingCount > 0 ? Number(r.expert.ratingAvg) : null,
    reviewCount: r.expert.ratingCount,
    savedAt: r.createdAt.toISOString(),
  }));
  return paginatedResult(items, { page, limit, total });
}

export async function saveExpert(auth, expertId) {
  assertUuid(expertId);
  await getDb().customerSavedExpert.upsert({
    where: {
      customerProfileId_expertProfileId: {
        customerProfileId: auth.customerProfileId,
        expertProfileId: expertId,
      },
    },
    create: { customerProfileId: auth.customerProfileId, expertProfileId: expertId },
    update: {},
  });
  return { saved: true };
}

export async function unsaveExpert(auth, expertId) {
  assertUuid(expertId);
  await getDb().customerSavedExpert.deleteMany({
    where: { customerProfileId: auth.customerProfileId, expertProfileId: expertId },
  });
  return { saved: false };
}
