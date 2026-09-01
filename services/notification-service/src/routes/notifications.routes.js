import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import {
  deviceTokenRequestSchema,
  updateNotificationPreferencesRequestSchema,
} from "@xprtlink/shared/contracts";
import * as svc from "../services/notificationService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";

const router = Router();

// ── Internal dispatch endpoint (no JWT) — guarded by SERVICE_SECRET ──────────
function internalServiceGuard(req, res, next) {
  const secret = process.env.SERVICE_SECRET;
  const header = req.headers["x-internal-service"];
  if (!header) return res.status(403).json({ success: false, message: "Forbidden" });
  if (secret && process.env.NODE_ENV === "production" && header !== secret) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  next();
}

/**
 * POST /api/v1/notifications/dispatch
 * Internal-only — creates in-app notification records for one or more users.
 * Body: { userIds: string[], title: string, body: string, data?: object }
 */
router.post(
  "/dispatch",
  internalServiceGuard,
  asyncHandler(async (req, res) => {
    const data = await svc.dispatchNotification(req.body);
    return ResponseFormatter.success(res, { message: "Notifications dispatched", data });
  })
);

// All routes below require authentication
router.use(authenticate);

router.post(
  "/device-token",
  asyncHandler(async (req, res) => {
    const body = deviceTokenRequestSchema.parse(req.body);
    const data = await svc.registerDeviceToken(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("deviceTokenRegistered"), data });
  })
);

router.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const data = await svc.getUnreadCount(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("unreadCount"), data });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const data = await svc.markAllRead(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("allNotificationsMarkedRead"), data });
  })
);

router.get(
  "/preferences",
  asyncHandler(async (req, res) => {
    const data = await svc.getPreferences(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("notificationPreferences"), data });
  })
);

router.patch(
  "/preferences",
  asyncHandler(async (req, res) => {
    const body = updateNotificationPreferencesRequestSchema.parse(req.body);
    const data = await svc.updatePreferences(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("preferencesUpdated"), data });
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await svc.listNotifications(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("notifications"), ...data });
  })
);

router.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const data = await svc.markNotificationRead(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("notificationMarkedRead"), data });
  })
);

/**
 * DELETE /api/v1/notifications
 * Clear all notifications for the current user (soft delete — rows are retained).
 * Role-agnostic: used by both the customer and the expert app, scoped by userId.
 * Declared before "/:id" for readability; Express matches on method + path, so the
 * two DELETE routes cannot shadow each other.
 */
router.delete(
  "/",
  asyncHandler(async (req, res) => {
    const data = await svc.clearAllNotifications(req.auth);
    return ResponseFormatter.success(res, { message: getMessage("allNotificationsCleared"), data });
  })
);

/**
 * DELETE /api/v1/notifications/:id
 * Clear a single notification (soft delete). Scoped by userId — clearing another
 * user's notification returns 404. Idempotent: repeating the call succeeds.
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = await svc.clearNotification(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("notificationCleared"), data });
  })
);

export default router;
