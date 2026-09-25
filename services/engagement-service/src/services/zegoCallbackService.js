import { getDb } from "@xprtlink/shared/db";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "zegoCallbackService" });

/**
 * ZegoCloud Callback Event Handlers.
 *
 * These are the source of truth for consultation call state:
 *   - room_create  → room initialized (no action needed, consultation already exists)
 *   - user_login   → participant joined the room
 *   - user_logout   → participant left the room
 *   - room_close   → room destroyed → end consultation, calculate duration & charges
 *
 * ZegoCloud callback payload reference:
 *   { appid, event, nonce, timestamp, signature, room_id, id_name (userId), ... }
 */

// In-memory map to store timeout timers for missing participants.
// Safe here because ecosystem.config.cjs specifies a single instance.
const disconnectTimers = new Map();

const handlers = {
  room_create: handleRoomCreate,
  room_login: handleUserLogin,
  room_logout: handleUserLogout,
  room_close: handleRoomClose,
};

/**
 * Main dispatcher — called from the webhook route.
 */
export async function handleZegoCallback(payload) {
  log.info(`[zego-callback] Received event '${payload.event}' with payload:`, JSON.stringify(payload));
  
  try {
    const db = getDb();
    await db.zegoCallbackLog.create({
      data: {
        event: payload.event || "unknown",
        roomId: payload.room_id || null,
        payload: payload,
      },
    });
  } catch (err) {
    log.error(`[zego-callback] Failed to log raw event to DB: ${err.message}`);
  }

  const handler = handlers[payload.event];
  if (!handler) {
    log.info(`[zego-callback] Unhandled event: ${payload.event}`);
    return;
  }
  await handler(payload);
}

/**
 * room_create — Room was created on ZegoCloud.
 * The consultation record with zegoRoomId already exists.
 * We just log it for auditing.
 */
async function handleRoomCreate(payload) {
  const roomId = payload.room_id;
  log.info(`[zego-callback] Room created: ${roomId}`);
  // No DB update needed — consultation already has zegoRoomId from createConsultation
}

/**
 * user_login — A participant joined the room.
 *
 * When BOTH participants are connected → mark consultation as "in_progress"
 * and record startedAt (billing timer begins).
 *
 * ZegoCloud sends: { id_name: <userId>, ... }
 */
async function handleUserLogin(payload) {
  const roomId = payload.room_id;
  const userId = payload.user_account || payload.id_name;
  log.info(`[zego-callback] User joined: userId=${userId} room=${roomId}`);

  // Clear any existing missing participant timer since someone rejoined
  if (disconnectTimers.has(roomId)) {
    log.info(`[zego-callback] Clearing disconnect timer for room ${roomId}`);
    clearTimeout(disconnectTimers.get(roomId));
    disconnectTimers.delete(roomId);
  }

  const db = getDb();
  let consultation = await db.consultation.findFirst({
    where: { zegoRoomId: roomId },
    include: { customer: { include: { user: true } }, expert: true },
  });

  if (!consultation) {
    log.warn(`[zego-callback] No consultation found for room ${roomId}`);
    return;
  }

  // Update joinedParticipantIds atomically using Prisma push
  if (userId && !consultation.joinedParticipantIds.includes(userId)) {
    consultation = await db.consultation.update({
      where: { id: consultation.id },
      data: { joinedParticipantIds: { push: userId } },
      include: { customer: { include: { user: true } }, expert: true },
    });
  }

  // Only transition to in_progress if currently in accepted/ringing/requested
  if (!["requested", "ringing", "accepted"].includes(consultation.status)) {
    log.info(`[zego-callback] Consultation ${consultation.id} already ${consultation.status}, skipping`);
    return;
  }

  // Check if both the customer and the expert have joined.
  // The Flutter app may join the Zego room using either the Account ID (user.id)
  // or the Profile ID (customer.id / expert.id), so we accept either.
  const normalize = (id) => (id ?? '').replace(/-/g, '');

  const customerAccountId  = consultation.customer?.user?.id;   // Account/user UUID
  const customerProfileId  = consultation.customer?.id;          // Customer-profile UUID
  const expertAccountId    = consultation.expert?.userId;        // Account/user UUID
  const expertProfileId    = consultation.expert?.id;            // Expert-profile UUID

  const matchesCustomer = (id) =>
    (customerAccountId && normalize(id) === normalize(customerAccountId)) ||
    (customerProfileId && normalize(id) === normalize(customerProfileId));

  const matchesExpert = (id) =>
    (expertAccountId && normalize(id) === normalize(expertAccountId)) ||
    (expertProfileId && normalize(id) === normalize(expertProfileId));

  const hasCustomerJoined = consultation.joinedParticipantIds.some(matchesCustomer);
  const hasExpertJoined   = consultation.joinedParticipantIds.some(matchesExpert);

  if (!hasCustomerJoined || !hasExpertJoined) {
    log.info(
      `[zego-callback] Consultation ${consultation.id} — waiting for both participants to join` +
      ` (hasCustomer=${hasCustomerJoined}, hasExpert=${hasExpertJoined})` +
      ` joinedIds=${JSON.stringify(consultation.joinedParticipantIds)}`
    );
    return;
  }

  const now = new Date();
  await db.consultation.update({
    where: { id: consultation.id },
    data: {
      status: "in_progress",
      acceptedAt: consultation.acceptedAt ?? now,
      startedAt: consultation.startedAt ?? now,
    },
  });

  log.info(`[zego-callback] Consultation ${consultation.id} → in_progress (both participants joined)`);
}

/**
 * user_logout — A participant left the room.
 *
 * We log it but don't end the consultation yet — the room might still be active
 * (reconnection scenario). room_close is the definitive end signal.
 */
async function handleUserLogout(payload) {
  const roomId = payload.room_id;
  const userId = payload.user_account || payload.id_name;
  log.info(`[zego-callback] User left: userId=${userId} room=${roomId}`);
  
  const timeoutMins = Number(process.env.MISSING_PARTICIPANT_TIMEOUT_MINS) || 0;
  if (timeoutMins > 0) {
    const db = getDb();
    const consultation = await db.consultation.findFirst({
      where: { zegoRoomId: roomId },
    });

    if (consultation && consultation.status === "in_progress") {
      log.info(`[zego-callback] Starting ${timeoutMins}m missing participant timer for room ${roomId}`);
      if (disconnectTimers.has(roomId)) {
        clearTimeout(disconnectTimers.get(roomId));
      }
      
      const timer = setTimeout(async () => {
        log.info(`[zego-callback] Timeout reached for missing participant in room ${roomId}. Force closing.`);
        disconnectTimers.delete(roomId);
        // Simulate a room_close to complete the consultation properly
        await handleRoomClose({
          room_id: roomId,
          timestamp: Math.floor(Date.now() / 1000)
        });
      }, timeoutMins * 60 * 1000);
      
      disconnectTimers.set(roomId, timer);
    }
  }
}

/**
 * room_close — Room was destroyed on ZegoCloud.
 * This is the SOURCE OF TRUTH for "call ended".
 *
 * Actions:
 *   1. Mark consultation as "completed"
 *   2. Calculate duration from startedAt → now (ZegoCloud timestamp)
 *   3. Record endedAt
 */
async function handleRoomClose(payload) {
  const roomId = payload.room_id;
  const zegoTimestamp = payload.timestamp
    ? new Date(Number(payload.timestamp) * 1000)
    : new Date();

  log.info(`[zego-callback] Room closed: ${roomId}`);

  if (disconnectTimers.has(roomId)) {
    clearTimeout(disconnectTimers.get(roomId));
    disconnectTimers.delete(roomId);
  }

  const db = getDb();
  const consultation = await db.consultation.findFirst({
    where: { zegoRoomId: roomId },
    include: {
      customer: { include: { user: true } },
      expert: true,
    },
  });

  if (!consultation) {
    log.warn(`[zego-callback] No consultation found for room ${roomId}`);
    return;
  }

  // Only end if currently active
  if (!["requested", "ringing", "accepted", "in_progress"].includes(consultation.status)) {
    log.info(`[zego-callback] Consultation ${consultation.id} already ${consultation.status}, skipping room_close`);
    return;
  }

  // Calculate duration
  const startedAt = consultation.startedAt ?? consultation.acceptedAt ?? consultation.requestedAt;
  const endedAt = zegoTimestamp;
  const rawDurationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
  const durationSeconds = Math.ceil(rawDurationSeconds / 60) * 60;

  // If the call was never actually connected (no startedAt), the expert never
  // picked up / both parties never joined the room → it is NOT a completed
  // consultation. Mark it "failed" so it is never reported as "Completed".
  const wasConnected = Boolean(consultation.startedAt);
  const finalStatus = wasConnected ? "completed" : "failed";

  await db.consultation.update({
    where: { id: consultation.id },
    data: {
      status: finalStatus,
      endedAt,
      // Only record a real duration for connected calls; unconnected calls stay at 0.
      durationSeconds: wasConnected ? durationSeconds : 0,
    },
  });

  log.info(
    `[zego-callback] Consultation ${consultation.id} → ${finalStatus} ` +
    `(duration=${wasConnected ? durationSeconds : 0}s, connected=${wasConnected})`
  );

  // Trigger real Stripe capture via billing-service (internal call, no JWT needed)
  if (wasConnected && durationSeconds > 0) {
    try {
      const billingUrl = process.env.BILLING_SERVICE_URL ?? "http://localhost:4006";
      const result = await internalPost(
        billingUrl,
        `/api/v1/billing/consultations/${consultation.id}/capture`,
        { durationSeconds }
      );
      log.info(`[zego-callback] Billing capture result:`, JSON.stringify(result));
    } catch (err) {
      // Non-fatal — consultation is already marked completed; billing can be retried
      log.error(`[zego-callback] Billing capture call failed: ${err.message}`);
    }
  } else {
    log.info(`[zego-callback] Consultation ${consultation.id} — no charge (wasConnected=${wasConnected}, duration=${durationSeconds}s)`);
  }

  // No "Consultation Ended" push here — the Payment Successful notification
  // that follows the billing capture already signals the session is complete.
}
