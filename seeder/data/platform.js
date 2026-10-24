/** Seed: platform config + CMS pages + subscription plans */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const platformConfig = {
  commissionPercent: 15,
  maintenanceMode: false,
  supportEmail: "support@xpertlink.com",
  foundingMemberBadgeEnabled: true,
  currency: "USD",
  // Keys below mirror PLATFORM_SETTING_DEFAULTS in shared/contracts/settings.schema.js
  payoutSchedule: 7,
  featuredExpertWeights: { tierWeight: 100, ratingWeight: 10 },
};

/**
 * CMS pages — body HTML lives in ./cms/<slug>.html, exported verbatim from prod
 * (2026-10-24). Re-export from prod when the admin portal copy changes.
 */
const cmsBody = (slug) =>
  readFileSync(fileURLToPath(new URL(`./cms/${slug}.html`, import.meta.url)), "utf8");

export const cmsPages = [
  { slug: "privacy", title: "Privacy Policy", status: "published" },
  { slug: "terms", title: "Terms of Service", status: "published" },
  { slug: "contact", title: "Contact", status: "published" },
  { slug: "expert-standards", title: "Expert Standards Agreement", status: "published" },
].map((page) => ({ ...page, bodyHtml: cmsBody(page.slug) }));

/** Seed: FAQs — expert/shared entries from prod. Customer FAQs are not seeded (prod only had template text). */
export const faqs = [
  { question: "How do I set my availability?", answer: "Go to your Profile tab and edit your Schedule to open time slots.", type: "expert", sortOrder: 10 },
  { question: "When do I get paid?", answer: "Payouts are processed weekly directly to your linked bank account via Stripe.", type: "expert", sortOrder: 11 },
  { question: "Can I cancel a consultation?", answer: "Yes, but frequent cancellations may lower your expert rating.", type: "both", sortOrder: 12 },
];

export const subscriptionPlans = [
  {
    code: "core",
    name: "Core",
    tagline: 'For "New Experts"',
    description: 'For "New Experts"',
    priceMonthly: 9.99,
    visibilityBoost: "listing",
    isMostPopular: false,
    keyFeatures: [
      "Basic marketplace listing",
      "Standard visibility",
      "No advertisements",
    ],
  },
  {
    code: "professional",
    name: "Professional",
    tagline: 'For "Active Professionals"',
    description: 'For "Active Professionals"',
    priceMonthly: 29.99,
    visibilityBoost: "top_25",
    isMostPopular: true,
    keyFeatures: [
      "Top 25% search visibility",
      "1 Advertisement per month",
      "Enhanced marketplace listing",
    ],
  },
  {
    code: "elite",
    name: "Elite",
    tagline: 'For "High-Volume Experts"',
    description: 'For "High-Volume Experts"',
    priceMonthly: 49.99,
    visibilityBoost: "top_5",
    isMostPopular: false,
    keyFeatures: [
      "Top 5% search visibility",
      "4 Advertisements per month (1/week)",
      "Maximum marketplace visibility",
    ],
  },
];
