import bcrypt from "bcryptjs";
import Stripe from "stripe";
import { getDb, disconnectDb } from "@xprtlink/shared/db";
import { ADMIN_MODULES } from "@xprtlink/shared/constants/index.js";

const SALT_ROUNDS = 10;

async function syncStripePlans(plans) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.log("[seed] Stripe secret key not set. Skipping Stripe product sync.");
    return {};
  }

  const stripe = new Stripe(stripeSecretKey);
  const stripeMap = {};

  try {
    const existingProductsList = await stripe.products.list({ limit: 100, active: true });
    const existingProducts = existingProductsList.data;

    for (const plan of plans) {
      const priceCents = Math.round(plan.priceMonthly * 100);
      const expectedProductName = `XprtLink ${plan.name}`;

      // 1. Find product by metadata code or name
      let product = existingProducts.find(
        (p) =>
          p.metadata?.code === plan.code ||
          p.name.toLowerCase() === expectedProductName.toLowerCase()
      );

      if (!product) {
        console.log(`[seed] Creating Stripe product: "${expectedProductName}"...`);
        product = await stripe.products.create({
          name: expectedProductName,
          description: plan.description || `XprtLink ${plan.name} Expert Subscription`,
          metadata: { code: plan.code, platform: "xpertlink" },
        });
      } else {
        console.log(`[seed] Found existing Stripe product: ${product.id} (${product.name})`);
      }

      // 2. Find or create monthly price for this product
      const existingPricesList = await stripe.prices.list({
        product: product.id,
        active: true,
      });
      let price = existingPricesList.data.find(
        (p) => p.unit_amount === priceCents && p.recurring?.interval === "month"
      );

      if (!price) {
        console.log(`[seed] Creating Stripe price ($${plan.priceMonthly}/mo) for ${plan.name}...`);
        price = await stripe.prices.create({
          product: product.id,
          unit_amount: priceCents,
          currency: "usd",
          recurring: { interval: "month" },
          metadata: { code: plan.code },
        });
      } else {
        console.log(`[seed] Found existing Stripe price: ${price.id} ($${plan.priceMonthly}/mo)`);
      }

      stripeMap[plan.code] = {
        stripeProductId: product.id,
        stripePriceId: price.id,
      };
    }
  } catch (error) {
    console.warn("[seed] Warning: Stripe subscription plan sync failed:", error.message);
  }

  return stripeMap;
}

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
  "transactions",
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
  const stripeMap = await syncStripePlans(payload.subscriptionPlans);
  const planByCode = {};
  for (const plan of payload.subscriptionPlans) {
    const stripeInfo = stripeMap[plan.code] || {};
    const row = await db.subscriptionPlan.create({
      data: {
        code: plan.code,
        name: plan.name,
        tagline: plan.tagline ?? null,
        priceMonthlyCents: Math.round(plan.priceMonthly * 100),
        visibilityBoost: plan.visibilityBoost,
        keyFeatures: plan.keyFeatures ?? [],
        isMostPopular: plan.isMostPopular ?? false,
        stripeProductId: stripeInfo.stripeProductId ?? null,
        stripePriceId: stripeInfo.stripePriceId ?? null,
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
            categories: { connect: [{ id: category.id }] },
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
      const ratePerMinuteCents = c.durationMins > 0 ? Math.round(c.amountCents / c.durationMins) : 400;

      const consultation = await db.consultation.create({
        data: {
          customerId: customer._seedId,
          expertId: expert._seedId,
          status: c.status,
          ratePerMinuteCents,
          durationSeconds: c.durationMins * 60,
          requestedAt: createdAt,
          acceptedAt: createdAt,
          startedAt: createdAt,
          endedAt: c.status === "completed" ? new Date(createdAt.getTime() + c.durationMins * 60000) : null,
          billingStatus: c.status === "completed" ? "charged" : "pending",
          createdAt,
        },
      });

      if (c.status === "completed" && c.amountCents > 0) {
        const tx = await db.transaction.create({
          data: {
            type: "consultation_charge",
            amountCents: c.amountCents,
            currency: "USD",
            status: "succeeded",
            stripePaymentIntentId: `pi_seed_${consultation.id.slice(0, 8)}`,
            createdAt,
          },
        });

        const commissionCents = Math.round(c.amountCents * 0.15);
        const expertShareCents = c.amountCents - commissionCents;

        await db.consultationCharge.create({
          data: {
            consultationId: consultation.id,
            transactionId: tx.id,
            commissionCents,
            expertShareCents,
            createdAt,
          },
        });

        await db.expertEarningsLedger.create({
          data: {
            expertProfileId: expert._seedId,
            consultationId: consultation.id,
            grossCents: c.amountCents,
            commissionCents,
            netCents: expertShareCents,
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
          expertQuoteAmountCents: q.amountCents > 0 ? q.amountCents : null,
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
