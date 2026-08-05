import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

/**
 * Notifications stub — the DB notifications table is per-user push notifications.
 * Admin broadcast notifications are not yet in schema.
 * This returns an empty list until a broadcast model is added.
 */
export async function list(_req, res) {
  return ResponseFormatter.paginated(res, {
    items: [],
    page: 1, limit: 20, total: 0,
    message: "Broadcast notifications not yet implemented",
  });
}

export async function getById(req, res) {
  return res.status(404).json({ success: false, message: "Not found", code: "NOT_FOUND" });
}
