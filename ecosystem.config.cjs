require("dotenv").config();

const portMap = {
  "api-gateway": Number(process.env.API_GATEWAY_PORT || 4000),
  "user-service": Number(process.env.USER_SERVICE_PORT || 4001),
  "expert-service": Number(process.env.EXPERT_SERVICE_PORT || 4002),
  "catalog-service": Number(process.env.CATALOG_SERVICE_PORT || 4003),
  "engagement-service": Number(process.env.ENGAGEMENT_SERVICE_PORT || 4004),
  "messaging-service": Number(process.env.MESSAGING_SERVICE_PORT || 4005),
  "billing-service": Number(process.env.BILLING_SERVICE_PORT || 4006),
  "notification-service": Number(process.env.NOTIFICATION_SERVICE_PORT || 4007),
  "media-service": Number(process.env.MEDIA_SERVICE_PORT || 4008),
  "admin-service": Number(process.env.ADMIN_SERVICE_PORT || 4009),
};

const baseEnv = {
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  SERVICE_SECRET: process.env.SERVICE_SECRET,
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  USER_SERVICE_URL:
    process.env.USER_SERVICE_URL || `http://localhost:${portMap["user-service"]}`,
  EXPERT_SERVICE_URL:
    process.env.EXPERT_SERVICE_URL || `http://localhost:${portMap["expert-service"]}`,
  CATALOG_SERVICE_URL:
    process.env.CATALOG_SERVICE_URL || `http://localhost:${portMap["catalog-service"]}`,
  ENGAGEMENT_SERVICE_URL:
    process.env.ENGAGEMENT_SERVICE_URL || `http://localhost:${portMap["engagement-service"]}`,
  MESSAGING_SERVICE_URL:
    process.env.MESSAGING_SERVICE_URL || `http://localhost:${portMap["messaging-service"]}`,
  BILLING_SERVICE_URL:
    process.env.BILLING_SERVICE_URL || `http://localhost:${portMap["billing-service"]}`,
  NOTIFICATION_SERVICE_URL:
    process.env.NOTIFICATION_SERVICE_URL || `http://localhost:${portMap["notification-service"]}`,
  MEDIA_SERVICE_URL:
    process.env.MEDIA_SERVICE_URL || `http://localhost:${portMap["media-service"]}`,
  ADMIN_SERVICE_URL:
    process.env.ADMIN_SERVICE_URL || `http://localhost:${portMap["admin-service"]}`,
};

const services = Object.keys(portMap).map((name) => ({
  name,
  port: portMap[name],
}));

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
