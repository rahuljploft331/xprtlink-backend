import jwt from "jsonwebtoken";
import { getSecretSync } from "../config/secrets.js";

function getSecret() {
  const secret = getSecretSync("JWT_SECRET");
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return secret;
}

export function signAccessToken(payload) {
  return jwt.sign(payload, getSecret(), {
    expiresIn: getSecretSync("JWT_EXPIRES_IN", "7d"),
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, getSecret());
}

export function getExpiresInSeconds() {
  const raw = getSecretSync("JWT_EXPIRES_IN", "7d");
  if (raw.endsWith("d")) return parseInt(raw, 10) * 86400;
  if (raw.endsWith("h")) return parseInt(raw, 10) * 3600;
  if (raw.endsWith("m")) return parseInt(raw, 10) * 60;
  return parseInt(raw, 10) || 604800;
}
