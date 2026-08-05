import { getDb } from "../../getClient.js";

export function users() {
  return getDb().user;
}

export function customerProfiles() {
  return getDb().customerProfile;
}

export function refreshTokens() {
  return getDb().refreshToken;
}

export function deviceTokens() {
  return getDb().deviceToken;
}
