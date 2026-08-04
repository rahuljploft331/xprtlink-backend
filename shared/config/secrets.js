/**
 * Secrets loader.
 * Phase 1: reads process.env.
 * Later: same API can load from AWS Secrets Manager without changing call sites.
 */
export async function getSecret(key, fallback = undefined) {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return fallback;
  }
  return value;
}

export function getSecretSync(key, fallback = undefined) {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return fallback;
  }
  return value;
}
