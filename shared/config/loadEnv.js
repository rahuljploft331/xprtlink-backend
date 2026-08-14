import { getSecretSync } from "./secrets.js";

export function getServicePorts() {
  return {
    "api-gateway": Number(getSecretSync("API_GATEWAY_PORT", "4000")),
    "user-service": Number(getSecretSync("USER_SERVICE_PORT", "4001")),
    "expert-service": Number(getSecretSync("EXPERT_SERVICE_PORT", "4002")),
    "catalog-service": Number(getSecretSync("CATALOG_SERVICE_PORT", "4003")),
    "engagement-service": Number(getSecretSync("ENGAGEMENT_SERVICE_PORT", "4004")),
    "messaging-service": Number(getSecretSync("MESSAGING_SERVICE_PORT", "4005")),
    "billing-service": Number(getSecretSync("BILLING_SERVICE_PORT", "4006")),
    "notification-service": Number(getSecretSync("NOTIFICATION_SERVICE_PORT", "4007")),
    "media-service": Number(getSecretSync("MEDIA_SERVICE_PORT", "4008")),
    "admin-service": Number(getSecretSync("ADMIN_SERVICE_PORT", "4009")),
  };
}

export const SERVICE_PORTS = getServicePorts();

/**
 * Lightweight config for a service. Does not load .env itself —
 * PM2 / dotenv-cli / process env must provide variables.
 */
export function getConfig(serviceName) {
  const ports = getServicePorts();
  const defaultPort = ports[serviceName] ?? 4000;
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
      user: getSecretSync("USER_SERVICE_URL", `http://localhost:${ports["user-service"]}`),
      expert: getSecretSync("EXPERT_SERVICE_URL", `http://localhost:${ports["expert-service"]}`),
      catalog: getSecretSync("CATALOG_SERVICE_URL", `http://localhost:${ports["catalog-service"]}`),
      engagement: getSecretSync("ENGAGEMENT_SERVICE_URL", `http://localhost:${ports["engagement-service"]}`),
      messaging: getSecretSync("MESSAGING_SERVICE_URL", `http://localhost:${ports["messaging-service"]}`),
      billing: getSecretSync("BILLING_SERVICE_URL", `http://localhost:${ports["billing-service"]}`),
      notification: getSecretSync("NOTIFICATION_SERVICE_URL", `http://localhost:${ports["notification-service"]}`),
      media: getSecretSync("MEDIA_SERVICE_URL", `http://localhost:${ports["media-service"]}`),
      admin: getSecretSync("ADMIN_SERVICE_URL", `http://localhost:${ports["admin-service"]}`),
    },
  };
}
