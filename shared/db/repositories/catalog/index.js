import { getDb } from "../../getClient.js";

export function categories() {
  return getDb().category;
}

export function cmsPages() {
  return getDb().cmsPage;
}

export function platformSettings() {
  return getDb().platformSetting;
}

export function appConfig() {
  return getDb().appConfig;
}

export function subscriptionPlans() {
  return getDb().subscriptionPlan;
}
