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
  NODE_OPTIONS: process.env.NODE_OPTIONS || "--dns-result-order=ipv4first",
  // Call transcription (ZEGO Cloud ASR). This file passes env to services as an allowlist,
  // so a key missing here never reaches the process even when it is set in .env.
  ZEGO_ASR_ENABLED: process.env.ZEGO_ASR_ENABLED,
  ZEGO_ASR_API_URL: process.env.ZEGO_ASR_API_URL,
  ZEGO_ASR_VENDOR: process.env.ZEGO_ASR_VENDOR,
  ZEGO_ASR_PARAMS: process.env.ZEGO_ASR_PARAMS,
  ZEGO_ASR_SUBTITLE_TYPE: process.env.ZEGO_ASR_SUBTITLE_TYPE,
  ZEGO_ASR_MAX_IDLE_SECONDS: process.env.ZEGO_ASR_MAX_IDLE_SECONDS,
  ZEGO_ASR_HOST_TAG: process.env.ZEGO_ASR_HOST_TAG,
  ZEGO_ASR_CALLBACK_SECRET: process.env.ZEGO_ASR_CALLBACK_SECRET,
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
  // Service Account JSON — required by notification-service and billing-service
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  SERVICE_ACCOUNT_JSON: process.env.SERVICE_ACCOUNT_JSON,
  GOOGLE_PACKAGE_NAME: process.env.GOOGLE_PACKAGE_NAME,
  // Dev/QA opt-in: lets another expert account re-claim a store purchase.
  // Declared here because PM2 children inherit the daemon's environment, which is
  // only refreshed when the daemon itself restarts — a new .env key would not
  // otherwise reach a running service on `pm2 restart --update-env`.
  SUBSCRIPTION_ALLOW_TRANSFER: process.env.SUBSCRIPTION_ALLOW_TRANSFER,
};

const services = Object.keys(portMap).map((name) => ({
  name,
  port: portMap[name],
}));

// ── Scheduled jobs (PM2 cron_restart) ────────────────────────────────────────
// Each runs a short-lived script that hits an internal endpoint and exits.
// autorestart:false + cron_restart makes PM2 re-launch the process on schedule
// only. Cron expressions can be overridden via env. Times are UTC.
const cronJobs = [
  {
    name: "billing-retry-captures",
    service: "billing-service",
    script: "scripts/run-retry-captures.js",
    cron: process.env.RETRY_CAPTURES_CRON || "*/10 * * * *", // every 10 min
  },
  {
    name: "billing-release-holds",
    service: "billing-service",
    script: "scripts/run-release-holds.js",
    cron: process.env.RELEASE_HOLDS_CRON || "5-59/10 * * * *", // every 10 min, offset from retry-captures
  },
  {
    name: "billing-payout-run",
    service: "billing-service",
    script: "scripts/run-payouts.js",
    cron: process.env.PAYOUT_RUN_CRON || "15 2 * * *", // 02:15 daily (job self-sizes window from payoutSchedule)
  },
  {
    name: "billing-retry-payouts",
    service: "billing-service",
    script: "scripts/run-retry-payouts.js",
    cron: process.env.RETRY_PAYOUTS_CRON || "45 3 * * *", // 03:45 daily (recover failed transfers from prior runs)
  },
  {
    name: "billing-expire-subscriptions",
    service: "billing-service",
    script: "scripts/run-expire-subscriptions.js",
    cron: process.env.EXPIRE_SUBSCRIPTIONS_CRON || "30 2 * * *", // 02:30 daily
  },
  {
    name: "engagement-expire-quotes",
    service: "engagement-service",
    script: "scripts/run-expire-quotes.js",
    cron: process.env.EXPIRE_QUOTES_CRON || "*/15 * * * *", // every 15 min
  },
];

module.exports = {
  apps: [
    ...services.map((svc) => ({
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
    ...cronJobs.map((job) => ({
      name: job.name,
      script: job.script,
      namespace: "xpertlink-workspace",
      interpreter: "node",
      cwd: `./services/${job.service}`,
      instances: 1,
      exec_mode: "fork",
      env: { ...baseEnv, SERVICE_NAME: job.name },
      error_file: `../../logs/${job.name}-error.log`,
      out_file: `../../logs/${job.name}-out.log`,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      // Cron-only lifecycle: don't keep restarting after the script exits;
      // PM2 relaunches it on the cron schedule.
      autorestart: false,
      cron_restart: job.cron,
      watch: false,
    })),
  ],
};
