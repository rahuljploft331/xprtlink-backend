/**
 * SSE Hub — in-process singleton pub/sub bus for admin real-time events.
 *
 * Architecture:
 *   - Each connected admin browser opens GET /api/v1/admin/events (text/event-stream)
 *   - The route handler calls sseHub.subscribe(res) — the response object is kept alive
 *   - Any service/controller calls sseHub.publish(event, data) to broadcast to ALL admins
 *   - On disconnect (client closes tab, network drop) the response is automatically removed
 *
 * Events published:
 *   ticket:created         — new support ticket submitted by user
 *   verification:submitted — expert submitted a verification request
 *   report:filed           — customer filed an expert report
 *   consultation:completed — consultation ended (billing alert)
 *   user:registered        — new user sign-up
 *   review:flagged         — a review was auto-flagged
 */

/** @type {Set<import('express').Response>} */
const clients = new Set();

/**
 * Register an Express response object as an SSE client.
 * Sets the necessary headers and adds a heartbeat + cleanup.
 *
 * @param {import('express').Response} res
 */
export function subscribe(res) {
  // SSE headers
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });
  res.flushHeaders();

  // Send an immediate comment to confirm connection
  res.write(": connected\n\n");

  clients.add(res);

  // Heartbeat every 25 s to keep the connection alive through proxies/load balancers
  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeat);
      clients.delete(res);
      return;
    }
    res.write(": ping\n\n");
  }, 25_000);

  // Clean up when client disconnects
  res.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

/**
 * Broadcast an SSE event to all connected admin clients.
 *
 * @param {string} event  - event name (e.g. "ticket:created")
 * @param {object} data   - JSON-serialisable payload
 */
export function publish(event, data) {
  if (clients.size === 0) return; // no one listening, skip serialisation

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of clients) {
    if (!res.writableEnded) {
      res.write(payload);
    } else {
      clients.delete(res);
    }
  }
}

/** How many admin tabs are currently connected (useful for health/debug). */
export function clientCount() {
  return clients.size;
}
