/** Seed: platform config + CMS stubs */
export const platformConfig = {
  commissionPercent: 15,
  maintenanceMode: false,
  supportEmail: "support@xpertlink.com",
  foundingMemberBadgeEnabled: true,
  currency: "USD",
};

export const cmsPages = [
  { 
    slug: "home", 
    title: "Homepage", 
    status: "published",
    bodyHtml: `<h1>Welcome to XprtLink</h1><p>The premier two-sided expert consultation marketplace.</p>`
  },
  { 
    slug: "privacy", 
    title: "Privacy Policy", 
    status: "published",
    bodyHtml: `<h1>Privacy Policy</h1><p>Your privacy is important to XprtLink. This document outlines how we handle customer and expert data, including messaging, video calls, and payment information.</p>`
  },
  { 
    slug: "terms", 
    title: "Terms of Service", 
    status: "published",
    bodyHtml: `<h1>Terms of Service</h1><p>By using the XprtLink platform as a Customer or Expert, you agree to our per-minute billing policies, manual call acceptance, and consultation terms.</p>`
  },
  { 
    slug: "contact", 
    title: "Contact", 
    status: "published",
    bodyHtml: `<h1>Contact Us</h1><p>Reach out to XprtLink support at support@xpertlink.com for help with your expert profile or consultation inquiries.</p>`
  },
  { 
    slug: "expert-standards", 
    title: "Expert Standards Agreement", 
    status: "published",
    bodyHtml: `<h1>Expert Standards Agreement</h1><p>All experts on XprtLink must abide by our professional standards. This includes maintaining accurate availability, professional conduct during UIKit video calls, and prompt response to Quote Requests.</p>`
  },
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
