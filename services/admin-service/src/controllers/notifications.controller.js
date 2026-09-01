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

export async function send(req, res) {
  const { title, body, audience, type = "system" } = req.body;
  if (!title || !body) {
    return res.status(400).json({ success: false, message: "Title and body are required." });
  }

  // Determine user query filter based on audience
  let roleFilter = {};
  if (audience === "customers") roleFilter = { role: "CUSTOMER" };
  else if (audience === "experts") roleFilter = { role: "EXPERT" };

  const db = getDb();
  
  // Get users matching audience
  const users = await db.user.findMany({
    where: roleFilter,
    select: {
      id: true,
      notificationPref: {
        select: { preferences: true }
      }
    }
  });

  // Filter based on type and preferences
  let targetUserIds = [];
  for (const u of users) {
    if (type === "marketing") {
      const prefs = u.notificationPref?.preferences || {};
      // Respect user preferences (if marketing is explicitly false, skip)
      if (prefs.marketing === false) {
        continue;
      }
    }
    targetUserIds.push(u.id);
  }

  if (targetUserIds.length === 0) {
    return ResponseFormatter.success(res, { message: "No matching users found for audience.", data: { dispatched: 0 } });
  }

  // Insert notifications
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
