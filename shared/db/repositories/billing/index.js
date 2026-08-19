import { getDb } from "../../getClient.js";

export function paymentMethods() {
  return getDb().paymentMethod;
}

export function transactions() {
  return getDb().transaction;
}

export function payouts() {
  return getDb().expertPayout;
}

export function earningsLedger() {
  return getDb().expertEarningsLedger;
}

export function consultationCharges() {
  return getDb().consultationCharge;
}
