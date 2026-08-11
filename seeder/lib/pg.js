import bcrypt from "bcryptjs";
import { getDb, disconnectDb } from "@xprtlink/shared/db";
import { ADMIN_MODULES } from "@xprtlink/shared/constants/index.js";

const SALT_ROUNDS = 10;

/** Tables cleared in FK-safe order (children first). */
const TRUNCATE_ORDER = [
  "admin_audit_logs",
  "admin_permissions",
  "conversation_read_states",
  "message_attachments",
  "messages",
  "conversations",
  "quote_status_events",
  "quote_attachments",
  "quote_requests",
  "reviews",
  "expert_reports",
  "consultation_charges",
  "expert_earnings_ledger",
  "consultations",
  "expert_verification_documents",
  "expert_verifications",
  "expert_availability_logs",
  "expert_subscriptions",
  "expert_settings",
  "expert_payouts",
  "payment_methods",
  "notifications",
  "notification_preferences",
  "device_tokens",
  "otp_challenges",
  "refresh_tokens",
  "auth_sessions",
  "customer_saved_experts",
  "customer_recently_viewed",
  "customer_profiles",
  "expert_profiles",
  "media_assets",
  "users",
  "cms_pages",
  "subscription_plans",
  "platform_settings",
  "app_config",
  "categories",
  "admin_users",
];

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

function mapVerificationStatus(status) {
  const map = {
    approved: "approved",
    pending: "pending",
    rejected: "rejected",
  };
  return map[status] ?? "unverified";
}

function isSearchEligible(verificationStatus, hasActivePlan) {
  return verificationStatus === "approved" && hasActivePlan;
}

/**
 * Wipe all seed tables. Requires DATABASE_URL.
 */
export async function truncateAllTables() {
  const db = getDb();
  const tables = TRUNCATE_ORDER.map((t) => `"${t}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/**
 * Insert demo data from buildSeedPayload() into PostgreSQL.
 */
export async function seedPostgres(payload) {
  await truncateAllTables();
  const db = getDb();

  // Categories
  const categoryBySlug = {};
  for (const cat of payload.categories) {
    const row = await db.category.create({
      data: {
        slug: cat.slug,
        name: cat.name,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
      },
    });
    categoryBySlug[cat.slug] = row;
  }

  // Subscription plans
  const planByCode = {};
  for (const plan of payload.subscriptionPlans) {
    const row = await db.subscriptionPlan.create({
      data: {
        code: plan.code,
        name: plan.name,
        priceMonthlyCents: Math.round(plan.priceMonthly * 100),
        visibilityBoost: plan.visibilityBoost,
      },
    });
    planByCode[plan.code] = row;
  }

  // Platform settings (key-value)
  const pc = payload.platformConfig;
  const settings = {
    commissionPercent: pc.commissionPercent,
    maintenanceMode: pc.maintenanceMode,
    supportEmail: pc.supportEmail,
    foundingMemberBadgeEnabled: pc.foundingMemberBadgeEnabled,
    currency: pc.currency,
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.platformSetting.create({
      data: { key, value },
    });
  }

  // App config singleton
  await db.appConfig.create({
    data: {
      minAppVersion: "1.0.0",
      forceUpdate: false,
      maintenanceMessage: pc.maintenanceMode ? "Platform under maintenance." : null,
    },
  });

  // CMS pages
  for (const page of payload.cmsPages) {
    await db.cmsPage.create({
      data: {
        slug: page.slug,
        title: page.title,
        bodyHtml: `<p>${page.title} content placeholder.</p>`,
        status: page.status === "published" ? "published" : "draft",
        publishedAt: page.status === "published" ? new Date() : null,
      },
    });
  }

  // Admin users
  for (const admin of payload.admins) {
    const passwordHash = await hashPassword(admin.password);
    const created = await db.adminUser.create({
      data: {
        email: admin.email,
        name: admin.name,
        role: admin.role,
        status: admin.status === "active" ? "active" : "suspended",
        passwordHash,
      },
    });

    if (admin.role === "subadmin" && admin.permissions) {
      for (const module of ADMIN_MODULES) {
        const level = admin.permissions[module] ?? "none";
        await db.adminPermission.create({
          data: {
            adminUserId: created.id,
            module,
            level,
          },
        });
      }
    }
  }

  // Customers
  for (const customer of payload.customers) {
    const passwordHash = await hashPassword(customer.password);
    const user = await db.user.create({
      data: {
        email: customer.email,
        passwordHash,
        status: customer.status,
        emailVerifiedAt: new Date(),
        customerProfile: {
          create: {
            firstName: customer.firstName,
            lastName: customer.lastName,
          },
        },
      },
      include: { customerProfile: true },
    });
    customer._seedId = user.customerProfile.id;
    customer._userId = user.id;
  }

  // Experts
  for (const expert of payload.experts) {
    const passwordHash = await hashPassword(expert.password);
    const category = categoryBySlug[expert.categorySlug];
    const verificationStatus = mapVerificationStatus(expert.verificationStatus);
    const hasPlan = Boolean(expert.plan && planByCode[expert.plan]);
    const rateCents = Math.round(expert.consultationRate * 100);
    const ratingCount = expert.rating != null ? 12 : 0;

    const user = await db.user.create({
      data: {
        email: expert.email,
        passwordHash,
        status: "active",
        emailVerifiedAt: new Date(),
        expertProfile: {
          create: {
            categoryId: category.id,
            firstName: expert.firstName,
            lastName: expert.lastName,
            headline: `${expert.firstName} ${expert.lastName}`,
            bio: `Experienced ${category.name} professional.`,
            consultationRateCents: rateCents,
            availabilityStatus: expert.availability,
            verificationStatus,
            onboardingStep: 5,
            onboardingCompletedAt: new Date(),
            foundingMember: expert.plan === "elite",
            ratingAvg: expert.rating ?? 0,
            ratingCount,
            searchEligible: isSearchEligible(verificationStatus, hasPlan),
            settings: { create: { preferences: {} } },
          },
        },
      },
      include: { expertProfile: true },
    });

    const expertProfile = user.expertProfile;

    if (verificationStatus !== "unverified") {
      await db.expertVerification.create({
        data: {
          expertProfileId: expertProfile.id,
          status: verificationStatus,
          submittedAt: new Date(),
          reviewedAt: verificationStatus === "pending" ? null : new Date(),
        },
      });
    }

    if (hasPlan) {
      const plan = planByCode[expert.plan];
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await db.expertSubscription.create({
        data: {
          expertProfileId: expertProfile.id,
          planId: plan.id,
          store: "apple",
          externalSubscriptionId: `seed_${expert.email}`,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
    }

    expert._seedId = expertProfile.id;
    expert._userId = user.id;
  }

  // Seed consultations & transactions
  if (payload.consultations && payload.customers.length > 0 && payload.experts.length > 0) {
    const now = Date.now();
    for (const c of payload.consultations) {
      const customer = payload.customers[c.customerIndex % payload.customers.length];
      const expert = payload.experts[c.expertIndex % payload.experts.length];
      const createdAt = new Date(now - (c.daysAgo || 1) * 24 * 60 * 60 * 1000);

      const consultation = await db.consultation.create({
        data: {
          customerId: customer._seedId,
          expertId: expert._seedId,
          status: c.status,
          durationSeconds: c.durationMins * 60,
          rateCentsPerMin: 400,
          totalAmountCents: c.amountCents,
          createdAt,
        },
      });

      if (c.status === "completed" && c.amountCents > 0) {
        await db.transaction.create({
          data: {
            consultationId: consultation.id,
            customerId: customer._seedId,
            expertId: expert._seedId,
            amountCents: c.amountCents,
            type: "consultation_charge",
            status: "succeeded",
            createdAt,
          },
        });
      }
    }
  }

  // Seed quote requests
  if (payload.quotes && payload.customers.length > 0 && payload.experts.length > 0) {
    const now = Date.now();
    for (const q of payload.quotes) {
      const customer = payload.customers[q.customerIndex % payload.customers.length];
      const expert = payload.experts[q.expertIndex % payload.experts.length];
      const createdAt = new Date(now - (q.daysAgo || 1) * 24 * 60 * 60 * 1000);

      await db.quoteRequest.create({
        data: {
          customerId: customer._seedId,
          expertId: expert._seedId,
          title: q.title,
          description: `Details for ${q.title}`,
          status: q.status,
          quoteAmountCents: q.amountCents > 0 ? q.amountCents : null,
          createdAt,
        },
      });
    }
  }

  return {
    database: "postgresql",
    counts: {
      categories: payload.categories.length,
      admins: payload.admins.length,
      customers: payload.customers.length,
      experts: payload.experts.length,
      cmsPages: payload.cmsPages.length,
      subscriptionPlans: payload.subscriptionPlans.length,
      consultations: payload.consultations?.length || 0,
      quotes: payload.quotes?.length || 0,
    },
  };
}

export async function resetPostgres() {
  await truncateAllTables();
}

export async function closePostgres() {
  await disconnectDb();
}
