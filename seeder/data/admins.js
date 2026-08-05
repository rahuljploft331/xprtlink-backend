/**
 * Seed: admin portal users
 * Roles: super_admin | subadmin
 * Subadmin permissions: none | view | edit per module
 */

const supportPermissions = {
  dashboard: "view",
  customers: "edit",
  experts: "view",
  verifications: "edit",
  categories: "none",
  consultations: "view",
  quotes: "view",
  payments: "none",
  payouts: "none",
  subscriptions: "view",
  reviews: "edit",
  cms: "none",
  notifications: "view",
  reports: "view",
  admins: "none",
  settings: "none",
};

const financePermissions = {
  dashboard: "view",
  customers: "view",
  experts: "view",
  verifications: "none",
  categories: "none",
  consultations: "view",
  quotes: "view",
  payments: "edit",
  payouts: "edit",
  subscriptions: "view",
  reviews: "none",
  cms: "none",
  notifications: "none",
  reports: "view",
  admins: "none",
  settings: "none",
};

export const admins = [
  {
    email: "admin@xpertlink.local",
    name: "Ops Admin",
    role: "super_admin",
    status: "active",
    password: "Admin@123",
    permissions: null,
  },
  {
    email: "support@xpertlink.local",
    name: "Support Lead",
    role: "subadmin",
    status: "active",
    password: "Support@123",
    permissions: supportPermissions,
  },
  {
    email: "finance@xpertlink.local",
    name: "Finance Viewer",
    role: "subadmin",
    status: "active",
    password: "Finance@123",
    permissions: financePermissions,
  },
];
