import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { getDb } from "@xprtlink/shared/db/getClient.js";

/**
 * Notifications stub — the DB notifications table is per-user push notifications.
 * Admin broadcast notifications are not yet in schema.
 * This returns an empty list until a broadcast model is added.
 */
export async function list(req, res) {
  const db = getDb();
  
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const logs = await db.adminBroadcast.findMany({
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });
  
  const total = await db.adminBroadcast.count();

  const items = logs.map(log => ({
    id: log.id,
    title: log.title,
    audience: log.audience,
    type: log.type,
    status: log.status.charAt(0).toUpperCase() + log.status.slice(1),
    createdAt: log.createdAt
  }));

  return ResponseFormatter.paginated(res, {
    items,
    page,
    limit,
    total,
    message: "Notifications retrieved",
  });
}

export async function getById(req, res) {
  const db = getDb();
  const notification = await db.adminBroadcast.findUnique({
    where: { id: req.params.id }
  });
  if (!notification) {
    return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });
  }
  return ResponseFormatter.success(res, { data: notification });
}

import { broadcastNotificationRequestSchema } from "@xprtlink/shared/contracts/admin.schema.js";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@xprtlink/shared/constants/index.js";

import { logAdminAction } from "#utils/audit.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";

export async function send(req, res) {
  let validated;
  try {
    validated = broadcastNotificationRequestSchema.parse(req.body);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.errors?.[0]?.message || "Invalid payload" });
  }

  const { title, body, audience, type } = validated;
  const status = req.body.status || "Sent";
  const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;


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

  if (targetUserIds.length === 0 && status !== "draft") {
    return ResponseFormatter.success(res, { message: "No matching users found for audience.", data: { dispatched: 0 } });
  }
  
  // Save to AdminBroadcast
  await db.adminBroadcast.create({
    data: {
      title,
      body,
      audience,
      type,
      status: status,
      scheduledAt: scheduledAt,
    }
  });

  if (status === "draft" || status === "scheduled") {
    return ResponseFormatter.success(res, { 
      message: `Notification saved as ${status}.`,
      data: { dispatched: 0 }
    });
  }


  const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
  const CHUNK_SIZE = 500;

  for (let i = 0; i < targetUserIds.length; i += CHUNK_SIZE) {
    const chunk = targetUserIds.slice(i, i + CHUNK_SIZE);
    try {
      await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: chunk,
        type: type,
        title: title,
        body: body,
        data: {}, // no extra payload needed for simple broadcast
      });
    } catch (err) {
      console.error(`[admin-service] Failed to dispatch broadcast chunk: ${err.message}`);
    }
  }

  await logAdminAction(req, "notification.broadcast", "Notification", null, {
    audience,
    type,
    userCount: targetUserIds.length,
    title,
  });

  return ResponseFormatter.success(res, { 
    message: `Notification sent to ${targetUserIds.length} user(s).`,
    data: { dispatched: targetUserIds.length }
  });
}
