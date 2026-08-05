import { getDb } from "../../getClient.js";

export function quotes() {
  return getDb().quoteRequest;
}

export function consultations() {
  return getDb().consultation;
}

export function reviews() {
  return getDb().review;
}

export function reports() {
  return getDb().expertReport;
}
