require("dotenv").config();

const baseEnv = {
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  SERVICE_SECRET: process.env.SERVICE_SECRET,
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  USER_SERVICE_URL: process.env.USER_SERVICE_URL || "http://localhost:4001",
  CATALOG_SERVICE_URL: process.env.CATALOG_SERVICE_URL || "http://localhost:4002",
  SEARCH_SERVICE_URL: process.env.SEARCH_SERVICE_URL || "http://localhost:4003",
  QUOTE_SERVICE_URL: process.env.QUOTE_SERVICE_URL || "http://localhost:4004",
  MESSAGING_SERVICE_URL: process.env.MESSAGING_SERVICE_URL || "http://localhost:4005",
  CONSULTATION_SERVICE_URL:
    process.env.CONSULTATION_SERVICE_URL || "http://localhost:4006",
  PAYMENT_SERVICE_URL: process.env.PAYMENT_SERVICE_URL || "http://localhost:4007",
  SUBSCRIPTION_SERVICE_URL:
    process.env.SUBSCRIPTION_SERVICE_URL || "http://localhost:4008",
  NOTIFICATION_SERVICE_URL:
    process.env.NOTIFICATION_SERVICE_URL || "http://localhost:4009",
  MEDIA_SERVICE_URL: process.env.MEDIA_SERVICE_URL || "http://localhost:4010",
  ADMIN_SERVICE_URL: process.env.ADMIN_SERVICE_URL || "http://localhost:4011",
  REPORTING_SERVICE_URL:
    process.env.REPORTING_SERVICE_URL || "http://localhost:4012",
};

const services = [
  { name: "api-gateway", port: 4000 },
  { name: "user-service", port: 4001 },
  { name: "catalog-service", port: 4002 },
  { name: "search-service", port: 4003 },
  { name: "quote-service", port: 4004 },
  { name: "messaging-service", port: 4005 },
  { name: "consultation-service", port: 4006 },
  { name: "payment-service", port: 4007 },
  { name: "subscription-service", port: 4008 },
  { name: "notification-service", port: 4009 },
  { name: "media-service", port: 4010 },
  { name: "admin-service", port: 4011 },
  { name: "reporting-service", port: 4012 },
];

module.exports = {
  apps: services.map((svc) => ({
    name: svc.name,
    script: "server.js",
    namespace: "xpertlink-workspace",
    interpreter: "node",
    cwd: `./services/${svc.name}`,
    instances: 1,
    exec_mode: "fork",
    env: {
      ...baseEnv,
      PORT: svc.port,
      SERVICE_NAME: svc.name,
    },
    error_file: `../../logs/${svc.name}-error.log`,
    out_file: `../../logs/${svc.name}-out.log`,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    merge_logs: true,
    autorestart: true,
    watch: baseEnv.NODE_ENV === "development",
    max_memory_restart: "500M",
  })),
};
