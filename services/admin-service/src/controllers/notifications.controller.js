import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


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
