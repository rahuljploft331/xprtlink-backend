import { getDb } from "../../getClient.js";

export function expertProfiles() {
  return getDb().expertProfile;
}

export function verifications() {
  return getDb().expertVerification;
}

export function subscriptions() {
  return getDb().expertSubscription;
}
