import { admins } from "./data/admins.js";
import { categories } from "./data/categories.js";
import { customers } from "./data/customers.js";
import { experts } from "./data/experts.js";
import { seedConsultations } from "./data/consultations.js";
import { seedQuotes } from "./data/quotes.js";
import {
  cmsPages,
  platformConfig,
  subscriptionPlans,
} from "./data/platform.js";

/**
 * Canonical seed payload for local reset / PostgreSQL import.
 */
export function buildSeedPayload() {
  const seededAt = new Date().toISOString();
  return {
    meta: {
      version: 1,
      seededAt,
      note: "XprtLink local seed. Passwords are demo-only — change in production.",
    },
    platformConfig,
    subscriptionPlans,
    cmsPages,
    categories,
    admins,
    customers,
    experts,
    consultations: seedConsultations,
    quotes: seedQuotes,
  };
}

export const SEED_COLLECTIONS = [
  "platformConfig",
  "subscriptionPlans",
  "cmsPages",
  "categories",
  "admins",
  "customers",
  "experts",
  "consultations",
  "quotes",
];

