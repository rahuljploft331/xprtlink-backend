import { getSecretSync } from "./secrets.js";

const SERVICE_PORTS = {
  "api-gateway": 4000,
  "user-service": 4001,
  "catalog-service": 4002,
  "search-service": 4003,
  "quote-service": 4004,
  "messaging-service": 4005,
  "consultation-service": 4006,
  "payment-service": 4007,
  "subscription-service": 4008,
  "notification-service": 4009,
  "media-service": 4010,
  "admin-service": 4011,
  "reporting-service": 4012,
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
    serviceUrls: {
      user: getSecretSync("USER_SERVICE_URL", "http://localhost:4001"),
      catalog: getSecretSync("CATALOG_SERVICE_URL", "http://localhost:4002"),
      search: getSecretSync("SEARCH_SERVICE_URL", "http://localhost:4003"),
      quote: getSecretSync("QUOTE_SERVICE_URL", "http://localhost:4004"),
      messaging: getSecretSync("MESSAGING_SERVICE_URL", "http://localhost:4005"),
      consultation: getSecretSync("CONSULTATION_SERVICE_URL", "http://localhost:4006"),
      payment: getSecretSync("PAYMENT_SERVICE_URL", "http://localhost:4007"),
      subscription: getSecretSync("SUBSCRIPTION_SERVICE_URL", "http://localhost:4008"),
      notification: getSecretSync("NOTIFICATION_SERVICE_URL", "http://localhost:4009"),
      media: getSecretSync("MEDIA_SERVICE_URL", "http://localhost:4010"),
      admin: getSecretSync("ADMIN_SERVICE_URL", "http://localhost:4011"),
      reporting: getSecretSync("REPORTING_SERVICE_URL", "http://localhost:4012"),
    },
  };
}

export { SERVICE_PORTS };
