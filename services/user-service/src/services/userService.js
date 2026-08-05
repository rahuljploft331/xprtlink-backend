import crypto from "crypto";
import { getDb } from "@xprtlink/shared/db";
import { issueTokens, loadUserContext, revokeRefreshToken } from "@xprtlink/shared/auth/tokens.js";
import { hashPassword, verifyPassword, hashToken, verifyTokenHash } from "@xprtlink/shared/auth/password.js";
import { toAuthSessionDto } from "@xprtlink/shared/mappers/auth.mapper.js";
import { toCustomerMeDto } from "@xprtlink/shared/mappers/customer.mapper.js";
import { toExpertPublicDto } from "@xprtlink/shared/mappers/expert.mapper.js";
import { badRequest, notFound, unauthorized } from "@xprtlink/shared/utils/errors.js";
import { parsePagination, paginatedResult } from "@xprtlink/shared/utils/pagination.js";
import { amountToCents } from "@xprtlink/shared/mappers/common.js";

const OTP_TTL_MS = 10 * 60 * 1000;

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

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

export async function register(body) {
  const { role, email, phone, password, firstName, lastName } = body;
  if (!email && !phone) throw badRequest("Email or phone is required", "VALIDATION_ERROR", "email");
  if (!firstName || !lastName) throw badRequest("Name is required");

  const db = getDb();
  if (email) {
    const exists = await db.user.findUnique({ where: { email } });
    if (exists) throw badRequest("Email already registered", "EMAIL_TAKEN", "email");
  }
  if (phone) {
    const exists = await db.user.findUnique({ where: { phone } });
    if (exists) throw badRequest("Phone already registered", "PHONE_TAKEN", "phone");
  }

  const passwordHash = await hashPassword(password);
  const userData = {
    email: email ?? null,
    phone: phone ?? null,
    passwordHash,
    status: "active",
  };

  if (role === "customer") {
    userData.customerProfile = {
      create: { firstName, lastName },
    };
  } else {
    const category = await db.category.findFirst({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
    if (!category) throw badRequest("No categories configured");
    userData.expertProfile = {
      create: {
        firstName,
        lastName,
        categoryId: category.id,
        consultationRateCents: 0,
        settings: { create: { preferences: {} } },
      },
    };
  }

  const user = await db.user.create({
    data: userData,
    include: {
      customerProfile: true,
      expertProfile: {
        include: { subscriptions: { where: { status: "active" }, take: 1 } },
      },
    },
  });

  const tokens = await issueTokens(user, role);
  if (!tokens) throw badRequest("Failed to create session");
  return tokens;
}

export async function login(body) {
  const { role, email, phone, password } = body;
  if (!email && !phone) throw badRequest("Email or phone is required");

  const db = getDb();
  const user = await db.user.findFirst({
    where: email ? { email } : { phone },
    include: {
      customerProfile: true,
      expertProfile: { include: { subscriptions: { where: { status: "active" }, take: 1 } } },
    },
  });

  if (!user || user.status !== "active") throw unauthorized("Invalid credentials");
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw unauthorized("Invalid credentials");

  const tokens = await issueTokens(user, role);
  if (!tokens) throw badRequest(`No ${role} profile on this account`, "PROFILE_MISSING");
  return tokens;
}

export async function logout(refreshToken) {
  if (refreshToken) await revokeRefreshToken(refreshToken);
}

export async function refresh(refreshToken, role) {
  if (!refreshToken) throw unauthorized("Refresh token required");

  const db = getDb();
  const tokens = await db.refreshToken.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    take: 200,
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        include: {
          customerProfile: true,
          expertProfile: { include: { subscriptions: { where: { status: "active" }, take: 1 } } },
        },
      },
    },
  });

  for (const row of tokens) {
    if (await verifyTokenHash(refreshToken, row.tokenHash)) {
      const resolvedRole =
        role ||
        (row.user.customerProfile ? "customer" : row.user.expertProfile ? "expert" : null);
      if (!resolvedRole) throw unauthorized("Invalid account");
      await db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      const issued = await issueTokens(row.user, resolvedRole);
      if (!issued) throw unauthorized("Session invalid");
      return issued;
    }
  }
  throw unauthorized("Invalid refresh token");
}

export async function sendOtp(body) {
  const { email, phone, purpose } = body;
  if (!email && !phone) throw badRequest("Email or phone required");
  const code = generateOtp();
  const codeHash = await hashToken(code);
  await getDb().otpChallenge.create({
    data: {
      email: email ?? null,
      phone: phone ?? null,
      codeHash,
      purpose,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  if (process.env.NODE_ENV !== "production") {
    console.log(`[otp] ${purpose} code for ${email || phone}: ${code}`);
  }
  return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000 };
}

export async function verifyOtp(body) {
  const { email, phone, code, purpose } = body;
  const challenge = await findValidOtp({ email, phone, purpose });
  const valid = await verifyTokenHash(code, challenge.codeHash);
  if (!valid) throw badRequest("Invalid OTP code", "INVALID_OTP");
  await getDb().otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });
  return { verified: true };
}

export async function resendOtp(body) {
  return sendOtp(body);
}

export async function forgotPassword(body) {
  return sendOtp({ ...body, purpose: "reset_password" });
}

export async function resetPassword(body) {
  const { email, phone, code, newPassword } = body;
  const challenge = await findValidOtp({ email, phone, purpose: "reset_password" });
  const valid = await verifyTokenHash(code, challenge.codeHash);
  if (!valid) throw badRequest("Invalid OTP code", "INVALID_OTP");

  const user = await getDb().user.findFirst({ where: email ? { email } : { phone } });
  if (!user) throw notFound("User not found");

  await getDb().$transaction([
    getDb().user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
    getDb().otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    }),
  ]);
  return { reset: true };
}

export async function changePassword(userId, body) {
  const { currentPassword, newPassword } = body;
  const user = await getDb().user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw unauthorized("Current password is incorrect");
  await getDb().user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  return { changed: true };
}

export async function checkAvailability(query) {
  const db = getDb();
  const result = {};
  if (query.email) {
    const row = await db.user.findUnique({ where: { email: query.email } });
    result.emailAvailable = !row;
  }
  if (query.mobile || query.phone) {
    const phone = query.mobile || query.phone;
    const row = await db.user.findUnique({ where: { phone } });
    result.phoneAvailable = !row;
  }
  return result;
}

export async function socialLogin(_body) {
  throw badRequest("Social login not configured", "NOT_IMPLEMENTED");
}

async function findValidOtp({ email, phone, purpose }) {
  const challenge = await getDb().otpChallenge.findFirst({
    where: {
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      ...(email ? { email } : { phone }),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) throw badRequest("OTP expired or not found", "OTP_EXPIRED");
  return challenge;
}

// ─── Customers ───────────────────────────────────────────────────────────────

export async function getCustomerMe(auth) {
  const user = await loadUserContext(auth.userId);
  if (!user?.customerProfile) throw notFound("Customer profile not found");
  return toCustomerMeDto({ profile: user.customerProfile, user, avatarUrl: null });
}

export async function updateCustomerMe(auth, body) {
  const db = getDb();
  const profile = await db.customerProfile.findFirst({ where: { userId: auth.userId } });
  if (!profile) throw notFound("Customer profile not found");

  const updated = await db.customerProfile.update({
    where: { id: profile.id },
    data: {
      ...(body.firstName ? { firstName: body.firstName } : {}),
      ...(body.lastName ? { lastName: body.lastName } : {}),
      ...(body.avatarMediaId !== undefined ? { avatarMediaId: body.avatarMediaId } : {}),
    },
  });
  const user = await db.user.findUnique({ where: { id: auth.userId } });
  return toCustomerMeDto({ profile: updated, user, avatarUrl: null });
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

export async function recordRecentlyViewed(auth, expertId) {
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
  await getDb().customerSavedExpert.deleteMany({
    where: { customerProfileId: auth.customerProfileId, expertProfileId: expertId },
  });
  return { saved: false };
}
