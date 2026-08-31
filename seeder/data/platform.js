/** Seed: platform config + CMS stubs */
export const platformConfig = {
  commissionPercent: 15,
  maintenanceMode: false,
  supportEmail: "support@xpertlink.com",
  foundingMemberBadgeEnabled: true,
  currency: "USD",
};

export const cmsPages = [
  { slug: "home", title: "Homepage", status: "published" },
  { slug: "faq", title: "FAQs", status: "published" },
  { slug: "privacy", title: "Privacy Policy", status: "published" },
  { slug: "terms", title: "Terms of Service", status: "published" },
  { slug: "contact", title: "Contact", status: "published" },
  { slug: "expert-standards", title: "Expert Standards Agreement", status: "published" },
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
