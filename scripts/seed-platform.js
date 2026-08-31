#!/usr/bin/env node
/**
 * seed-platform.js — Seeds only system prerequisite data (no users/experts).
 *
 * Creates:
 *  - categories
 *  - subscription plans (+ Stripe sync)
 *  - platform settings
 *  - app config
 *  - CMS pages
 *  - admin users
 *
 * This is the safe minimum prerequisite before running init:flows.
 * It uses upsert semantics so it is safe to run multiple times.
 *
 * Usage: node scripts/seed-platform.js
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import bcrypt from "bcryptjs";
import Stripe from "stripe";
import { getDb, disconnectDb } from "@xprtlink/shared/db/getClient.js";
import { ADMIN_MODULES } from "@xprtlink/shared/constants/index.js";

import { categories } from "../seeder/data/categories.js";
import { admins } from "../seeder/data/admins.js";
import {
  cmsPages,
  platformConfig,
  subscriptionPlans,
} from "../seeder/data/platform.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SALT_ROUNDS = 10;

async function syncStripePlans(db) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.log("[seed:platform] Stripe key not set — skipping Stripe sync.");
    return {};
  }

  const stripe = new Stripe(stripeSecretKey);
  const stripeMap = {};

  try {
    const existingProductsList = await stripe.products.list({ limit: 100, active: true });
    const existingProducts = existingProductsList.data;

    for (const plan of subscriptionPlans) {
      const priceCents = Math.round(plan.priceMonthly * 100);
      const expectedName = `XprtLink ${plan.name}`;

      let product = existingProducts.find(
        (p) => p.metadata?.code === plan.code || p.name.toLowerCase() === expectedName.toLowerCase()
      );

      if (!product) {
        product = await stripe.products.create({
          name: expectedName,
          description: plan.description || `XprtLink ${plan.name} Expert Subscription`,
          metadata: { code: plan.code, platform: "xpertlink" },
        });
        console.log(`[seed:platform] Stripe product created: ${product.id}`);
      }

      const existingPricesList = await stripe.prices.list({ product: product.id, active: true });
      let price = existingPricesList.data.find(
        (p) => p.unit_amount === priceCents && p.recurring?.interval === "month"
      );

      if (!price) {
        price = await stripe.prices.create({
          product: product.id,
          unit_amount: priceCents,
          currency: "usd",
          recurring: { interval: "month" },
          metadata: { code: plan.code },
        });
        console.log(`[seed:platform] Stripe price created: ${price.id}`);
      }

      stripeMap[plan.code] = {
        stripeProductId: product.id,
        stripePriceId: price.id,
      };
    }
  } catch (err) {
    console.warn("[seed:platform] Stripe sync failed (non-fatal):", err.message);
  }

  return stripeMap;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:platform] DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }

  const db = getDb();
  console.log("\n[seed:platform] ─── Seeding system prerequisites ───\n");

  // ── Categories ──────────────────────────────────────────────────────────────
  console.log("[seed:platform] Upserting categories...");
  for (const cat of categories) {
    await db.category.upsert({
      where: { slug: cat.slug },
      create: {
        slug: cat.slug,
        name: cat.name,
        sortOrder: cat.sortOrder ?? 0,
        isActive: cat.isActive ?? true,
      },
      update: {
        name: cat.name,
        sortOrder: cat.sortOrder ?? 0,
        isActive: cat.isActive ?? true,
      },
    });
  }
  console.log(`  ✓ ${categories.length} categories upserted`);

  // ── Subscription plans ───────────────────────────────────────────────────────
  console.log("[seed:platform] Syncing subscription plans...");
  const stripeMap = await syncStripePlans(db);
  for (const plan of subscriptionPlans) {
    const stripeInfo = stripeMap[plan.code] || {};
    await db.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: {
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
      update: {
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
  }
  console.log(`  ✓ ${subscriptionPlans.length} subscription plans upserted`);

  // ── Platform settings ────────────────────────────────────────────────────────
  console.log("[seed:platform] Upserting platform settings...");
  const settings = {
    commissionPercent: platformConfig.commissionPercent,
    maintenanceMode: platformConfig.maintenanceMode,
    supportEmail: platformConfig.supportEmail,
    foundingMemberBadgeEnabled: platformConfig.foundingMemberBadgeEnabled,
    currency: platformConfig.currency,
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.platformSetting.upsert({
      where: { key },
      create: { key, value: String(value) },
      update: { value: String(value) },
    });
  }
  console.log(`  ✓ ${Object.keys(settings).length} platform settings upserted`);

  // ── App config ───────────────────────────────────────────────────────────────
  console.log("[seed:platform] Upserting app config...");
  const existingConfig = await db.appConfig.findFirst();
  if (!existingConfig) {
    await db.appConfig.create({
      data: {
        minAppVersion: "1.0.0",
        forceUpdate: false,
        maintenanceMessage: platformConfig.maintenanceMode ? "Platform under maintenance." : null,
      },
    });
    console.log("  ✓ app config created");
  } else {
    console.log("  ✓ app config already exists — skipped");
  }

  // ── CMS pages ────────────────────────────────────────────────────────────────
  console.log("[seed:platform] Upserting CMS pages...");
  for (const page of cmsPages) {
    await db.cmsPage.upsert({
      where: { slug: page.slug },
      create: {
        slug: page.slug,
        title: page.title,
        bodyHtml: `<p>${page.title} content placeholder.</p>`,
        status: page.status === "published" ? "published" : "draft",
        publishedAt: page.status === "published" ? new Date() : null,
      },
      update: {
        title: page.title,
        status: page.status === "published" ? "published" : "draft",
      },
    });
  }
  console.log(`  ✓ ${cmsPages.length} CMS pages upserted`);

  // ── Admin users ──────────────────────────────────────────────────────────────
  console.log("[seed:platform] Upserting admin users...");
  for (const admin of admins) {
    const existing = await db.adminUser.findUnique({ where: { email: admin.email } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(admin.password, SALT_ROUNDS);
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
            data: { adminUserId: created.id, module, level },
          });
        }
      }
      console.log(`  ✓ Admin created: ${admin.email} (${admin.role})`);
    } else {
      console.log(`  ⟳ Admin already exists: ${admin.email} — skipped`);
    }
  }

  console.log("\n[seed:platform] ✅ All prerequisites seeded.\n");
  await disconnectDb();
}

main().catch((err) => {
  console.error("[seed:platform] FAILED:", err);
  process.exit(1);
});
