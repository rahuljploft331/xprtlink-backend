import { getSecretSync } from "./secrets.js";

const SERVICE_PORTS = {
  "api-gateway": 4000,
  "user-service": 4001,
  "expert-service": 4002,
  "catalog-service": 4003,
  "engagement-service": 4004,
  "messaging-service": 4005,
  "billing-service": 4006,
  "notification-service": 4007,
  "media-service": 4008,
  "admin-service": 4009,
};

/**
 * Lightweight config for a service. Does not load .env itself —
 * PM2 / dotenv-cli / process env must provide variables.
 */
export function getConfig(serviceName) {
  const defaultPort = SERVICE_PORTS[serviceName] ?? 4000;
  return {
    serviceName,
    nodeEnv: getSecretSync("NODE_ENV", "development"),
    port: Number(getSecretSync("PORT", String(defaultPort))),
    corsOrigin: getSecretSync("CORS_ORIGIN", "*"),
    logLevel: getSecretSync("LOG_LEVEL", "info"),
    jwtSecret: getSecretSync("JWT_SECRET"),
    jwtExpiresIn: getSecretSync("JWT_EXPIRES_IN", "7d"),
    serviceSecret: getSecretSync("SERVICE_SECRET"),
    rateLimitWindowMs: Number(getSecretSync("RATE_LIMIT_WINDOW_MS", "900000")),
    rateLimitMax: Number(getSecretSync("RATE_LIMIT_MAX", "100")),
    rateLimitAuthWindowMs: Number(getSecretSync("RATE_LIMIT_AUTH_WINDOW_MS", "900000")),
    rateLimitAuthMax: Number(getSecretSync("RATE_LIMIT_AUTH_MAX", "10")),
    serviceUrls: {
      user: getSecretSync("USER_SERVICE_URL", "http://localhost:4001"),
      expert: getSecretSync("EXPERT_SERVICE_URL", "http://localhost:4002"),
      catalog: getSecretSync("CATALOG_SERVICE_URL", "http://localhost:4003"),
      engagement: getSecretSync("ENGAGEMENT_SERVICE_URL", "http://localhost:4004"),
      messaging: getSecretSync("MESSAGING_SERVICE_URL", "http://localhost:4005"),
      billing: getSecretSync("BILLING_SERVICE_URL", "http://localhost:4006"),
      notification: getSecretSync("NOTIFICATION_SERVICE_URL", "http://localhost:4007"),
      media: getSecretSync("MEDIA_SERVICE_URL", "http://localhost:4008"),
      admin: getSecretSync("ADMIN_SERVICE_URL", "http://localhost:4009"),
    },
  };
}

export { SERVICE_PORTS };
