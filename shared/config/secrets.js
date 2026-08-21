/**
 * Secrets loader.
 * Phase 1: reads process.env.
 * Later: same API can load from AWS Secrets Manager without changing call sites.
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// ------------------------------------------------------------------
// Configuration – read from env (add placeholders in .env.example)
// ------------------------------------------------------------------
const AWS_REGION = process.env.AWS_SECRETS_MANAGER_REGION ?? "us-west-2";
const AWS_SECRET_NAME = process.env.AWS_SECRETS_MANAGER_NAME ?? "xpertlink/backend";
// Optional endpoint for local mocks (LocalStack, etc.)
const AWS_ENDPOINT = process.env.AWS_SECRETS_MANAGER_ENDPOINT;

let cachedSecret = null;

export async function loadSecret() {
  if (cachedSecret) return cachedSecret;

  const client = new SecretsManagerClient({
    region: AWS_REGION,
    endpoint: AWS_ENDPOINT, // undefined → uses real AWS endpoint
  });

  try {
    const cmd = new GetSecretValueCommand({ SecretId: AWS_SECRET_NAME });
    const resp = await client.send(cmd);
    cachedSecret = JSON.parse(resp.SecretString ?? "{}");
    return cachedSecret;
  } catch (err) {
    console.warn("[Secrets] Unable to fetch from AWS Secrets Manager – falling back to env", err.message);
    cachedSecret = {};
    return cachedSecret;
  }
}

export async function getSecret(key, fallback = undefined) {
  // Prefer explicit env var – useful for dev overrides
  const envVal = process.env[key];
  if (envVal !== undefined && envVal !== "") return envVal;

  const secretObj = await loadSecret();
  return secretObj[key] ?? fallback;
}

export function getSecretSync(key, fallback = undefined) {
  const envVal = process.env[key];
  if (envVal !== undefined && envVal !== "") return envVal;

  if (!cachedSecret) {
    console.warn("[Secrets] getSecretSync called before async load – returning fallback");
    return fallback;
  }
  return cachedSecret[key] ?? fallback;
}
