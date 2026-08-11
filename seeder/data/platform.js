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
];

export const subscriptionPlans = [
  {
    code: "core",
    name: "Core",
    description: 'For "New Experts"',
    priceMonthly: 9.99,
    visibilityBoost: "listing",
  },
  {
    code: "professional",
    name: "Professional",
    description: 'For "Active Professionals"',
    priceMonthly: 29.99,
    visibilityBoost: "top_25",
  },
  {
    code: "elite",
    name: "Elite",
    description: 'For "High-Volume Experts"',
    priceMonthly: 49.99,
    visibilityBoost: "top_5",
  },
];
