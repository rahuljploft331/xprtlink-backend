import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { getDb } from "@xprtlink/shared/db/getClient.js";

/**
 * Notifications stub — the DB notifications table is per-user push notifications.
 * Admin broadcast notifications are not yet in schema.
 * This returns an empty list until a broadcast model is added.
 */
export async function list(_req, res) {
  return ResponseFormatter.paginated(res, {
    items: [],
    page: 1, limit: 20, total: 0,
    message: getMessage("broadcastNotificationsNotYetImplemented"),
  });
}

export async function getById(req, res) {
  return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
}

import { broadcastNotificationRequestSchema } from "@xprtlink/shared/contracts/admin.schema.js";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@xprtlink/shared/constants/index.js";

export async function send(req, res) {
  let validated;
  try {
    validated = broadcastNotificationRequestSchema.parse(req.body);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.errors?.[0]?.message || "Invalid payload" });
  }

  const { title, body, audience, type } = validated;

  let roleFilter = {};
  if (audience === "customers") roleFilter = { customerProfile: { isNot: null } };
  else if (audience === "experts") roleFilter = { expertProfile: { isNot: null } };

  const db = getDb();
  
  const users = await db.user.findMany({
    where: roleFilter,
    select: {
      id: true,
      expertProfile: { select: { id: true } },
      customerProfile: { select: { id: true } },
      notificationPref: { select: { preferences: true } }
    }
  });

  let targetUserIds = [];
  for (const u of users) {
    if (type === "marketing") {
      const prefs = u.notificationPref?.preferences || {};
      const isExpert = Boolean(u.expertProfile);
      
      let isOptedIn = false;
      if (isExpert) {
        isOptedIn = prefs.marketingCommunications ?? DEFAULT_NOTIFICATION_PREFERENCES.expert.marketingCommunications;
      } else {
        isOptedIn = prefs.marketingNotifications ?? DEFAULT_NOTIFICATION_PREFERENCES.customer.marketingNotifications;
      }

      if (!isOptedIn) {
        continue;
      }
    }
    targetUserIds.push(u.id);
  }

  if (targetUserIds.length === 0) {
    return ResponseFormatter.success(res, { message: "No matching users found for audience.", data: { dispatched: 0 } });
  }

  const data = targetUserIds.map((userId) => ({
    userId,
    title,
    body,
    type,
  }));

  await db.notification.createMany({
    data,
  });

  return ResponseFormatter.success(res, { 
    message: `Notification sent to ${targetUserIds.length} user(s).`,
    data: { dispatched: targetUserIds.length }
  });
}
