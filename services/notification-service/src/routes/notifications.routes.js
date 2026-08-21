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

export default router;
