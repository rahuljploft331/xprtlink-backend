/**
 * Domain repositories — services should use these instead of ad-hoc Prisma calls.
 * Each module owns writes to its tables; cross-domain reads via explicit includes.
 */

export * as userRepo from "./user/index.js";
export * as expertRepo from "./expert/index.js";
export * as catalogRepo from "./catalog/index.js";
export * as engagementRepo from "./engagement/index.js";
export * as messagingRepo from "./messaging/index.js";
export * as billingRepo from "./billing/index.js";
export * as notificationRepo from "./notification/index.js";
export * as mediaRepo from "./media/index.js";
export * as adminRepo from "./admin/index.js";
