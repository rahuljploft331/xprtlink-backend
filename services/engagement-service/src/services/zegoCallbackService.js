import { getDb } from "@xprtlink/shared/db";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";

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
  console.log(`[zego-callback] Received event '${payload.event}' with payload:`, JSON.stringify(payload));
  const handler = handlers[payload.event];
  if (!handler) {
    console.log(`[zego-callback] Unhandled event: ${payload.event}`);
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
  console.log(`[zego-callback] Room created: ${roomId}`);
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
  console.log(`[zego-callback] User joined: userId=${userId} room=${roomId}`);

  const db = getDb();
  let consultation = await db.consultation.findFirst({
    where: { zegoRoomId: roomId },
    include: { customer: { include: { user: true } }, expert: true },
  });

  if (!consultation) {
    console.warn(`[zego-callback] No consultation found for room ${roomId}`);
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
    console.log(`[zego-callback] Consultation ${consultation.id} already ${consultation.status}, skipping`);
    return;
  }

  // Check if both the customer and the expert have joined
  const customerId = consultation.customer?.user?.id;
  const expertId = consultation.expert?.userId;

  const hasCustomerJoined = customerId && consultation.joinedParticipantIds.includes(customerId);
  const hasExpertJoined = expertId && consultation.joinedParticipantIds.includes(expertId);

  if (!hasCustomerJoined || !hasExpertJoined) {
    console.log(`[zego-callback] Consultation ${consultation.id} — waiting for both participants to join (hasCustomer=${hasCustomerJoined}, hasExpert=${hasExpertJoined})`);
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

  console.log(`[zego-callback] Consultation ${consultation.id} → in_progress (both participants joined)`);
}

/**
 * user_logout — A participant left the room.
 *
 * We log it but don't end the consultation yet — the room might still be active
 * (reconnection scenario). room_close is the definitive end signal.
 */
async function handleUserLogout(payload) {
  const roomId = payload.room_id;
  const userId = payload.id_name;
  console.log(`[zego-callback] User left: userId=${userId} room=${roomId}`);
  // Don't end consultation on user_logout — wait for room_close
  // This handles reconnection scenarios gracefully
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

  console.log(`[zego-callback] Room closed: ${roomId}`);

  const db = getDb();
  const consultation = await db.consultation.findFirst({
    where: { zegoRoomId: roomId },
    include: {
      customer: { include: { user: true } },
      expert: true,
    },
  });

  if (!consultation) {
    console.warn(`[zego-callback] No consultation found for room ${roomId}`);
    return;
  }

  // Only end if currently active
  if (!["requested", "ringing", "accepted", "in_progress"].includes(consultation.status)) {
    console.log(`[zego-callback] Consultation ${consultation.id} already ${consultation.status}, skipping room_close`);
    return;
  }

  // Calculate duration
  const startedAt = consultation.startedAt ?? consultation.acceptedAt ?? consultation.requestedAt;
  const endedAt = zegoTimestamp;
  const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));

  // If the call was never actually connected (no startedAt), duration is 0 → no charge
  const wasConnected = Boolean(consultation.startedAt);

  await db.consultation.update({
    where: { id: consultation.id },
    data: {
      status: "completed",
      endedAt,
      durationSeconds,
      ...(consultation.startedAt ? {} : { startedAt }),
    },
  });

  console.log(
    `[zego-callback] Consultation ${consultation.id} → completed ` +
    `(duration=${durationSeconds}s, connected=${wasConnected})`
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
      console.log(`[zego-callback] Billing capture result:`, JSON.stringify(result));
    } catch (err) {
      // Non-fatal — consultation is already marked completed; billing can be retried
      console.error(`[zego-callback] Billing capture call failed: ${err.message}`);
    }
  } else {
    console.log(`[zego-callback] Consultation ${consultation.id} — no charge (wasConnected=${wasConnected}, duration=${durationSeconds}s)`);
  }

  // Notify both participants that the call has ended
  try {
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:4007";
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    const durationLabel = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    // Collect both participant userIds
    const userIds = [
      consultation.customer?.user?.id,
      consultation.expert?.userId,
    ].filter(Boolean);

    if (userIds.length > 0) {
      await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds,
        type: "call_ended",
        title: "Call Ended",
        body: wasConnected
          ? `Your consultation has ended. Duration: ${durationLabel}.`
          : "Your consultation has ended.",
        data: { consultationId: consultation.id },
      });
    }
  } catch (err) {
    // Non-fatal — consultation is already marked completed
    console.error(`[zego-callback] Post-call notification failed: ${err.message}`);
  }
}
