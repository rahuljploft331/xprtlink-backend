import { getDb } from "../../getClient.js";

export function conversations() {
  return getDb().conversation;
}

export function messages() {
  return getDb().message;
}
