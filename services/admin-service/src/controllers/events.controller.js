import { subscribe, clientCount } from "#utils/sseHub.js";

/**
 * GET /api/v1/admin/events
 *
 * Opens a long-lived Server-Sent Events connection.
 * The browser connects once; the server streams events as they happen.
 *
 * Accessible by any active admin (super_admin or subadmin with any permission).
 * No specific module permission is required — events are informational only.
 *
 * Client usage (React admin portal):
 *   const es = new EventSource('/api/v1/admin/events', {
 *     headers: { Authorization: `Bearer ${adminToken}` }
 *   });
 *   es.addEventListener('ticket:created', e => console.log(JSON.parse(e.data)));
 *   es.addEventListener('verification:submitted', e => ...);
 */
export function stream(req, res) {
  // subscribe() sets headers, writes initial comment, starts heartbeat, cleans up on close
  subscribe(res);
}

/**
 * GET /api/v1/admin/events/status
 * Quick debug endpoint — returns how many SSE clients are currently connected.
 */
export function status(req, res) {
  return res.json({ success: true, data: { connectedClients: clientCount() } });
}
