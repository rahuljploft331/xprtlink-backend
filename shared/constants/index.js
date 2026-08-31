export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

/** Mobile / marketplace roles */
export const ROLES = {
  CUSTOMER: "customer",
  EXPERT: "expert",
  ADMIN: "admin",
  SUBADMIN: "subadmin",
};

/**
 * Admin portal roles (RBAC-lite).
 * - super_admin: full access
 * - subadmin: page-level view | edit | none permissions
 */
export const ADMIN_ROLES = {
  SUPER_ADMIN: "super_admin",
  SUBADMIN: "subadmin",
};

export const ADMIN_PERMISSION_LEVELS = {
  NONE: "none",
  VIEW: "view",
  EDIT: "edit",
};

/** Admin modules that can be gated for subadmins (align with admin sitemap). */
export const ADMIN_MODULES = [
  "dashboard",
  "customers",
  "experts",
  "verifications",
  "categories",
  "consultations",
  "quotes",
  "payments",
  "payouts",
  "subscriptions",
  "reviews",
  "cms",
  "notifications",
  "reports",
  "admins",
  "settings",
];

export * from "./enums.js";

/**
 * Default notification preferences per role.
 * These are created when a user first accesses preferences (lazy) or on verification.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  expert: {
    consultationAlerts: true,
    quoteRequestUpdates: true,
    pushNotifications: true,
    subscriptionNotifications: true,
    marketingCommunications: false,
  },
  customer: {
    pushNotifications: true,
    consultationReminders: true,
    emailNotifications: true,
    marketingNotifications: false,
  },
};

export const SERVICE_NAMES = [
  "api-gateway",
  "user-service",
  "expert-service",
  "catalog-service",
  "engagement-service",
  "messaging-service",
  "billing-service",
  "notification-service",
  "media-service",
  "admin-service",
];
