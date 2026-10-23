import crypto from "node:crypto";
import { getDb } from "@xprtlink/shared/db";
import { logger } from "@xprtlink/shared/lib/logger.js";
import { resolveSpeakerRole } from "@xprtlink/shared/lib/zegoParticipants.js";
import { AsrApiError, asrVendor, isAsrEnabled, startAsrTask, stopAsrTask } from "./zegoAsrClient.js";
const log = logger.child({ module: "transcriptService" });

/**
 * Consultation transcripts (ZEGO Cloud Real-time ASR).
 *
 * Privacy: transcript text is call content. It is stored only on the segment rows, and
 * NEVER written to logs or zego_callback_logs — log ids and counts, not words.
 * A transcript is supporting evidence for admins; nothing here makes decisions.
 */

const asrFailure = (err) => ({
  status: "failed",
  lastErrorCode: String(err instanceof AsrApiError ? err.code ?? "ERROR" : "ERROR").slice(0, 64),
  lastErrorMessage: String(err?.message ?? "unknown error").slice(0, 500),
});

/**
 * Called when a consultation goes in_progress. No-op unless ZEGO_ASR_ENABLED.
 * The transcript row is the lock: only the request that creates it starts the task,
 * so duplicate room_login callbacks cannot start two. Never throws and never waits for
 * ZEGO — the webhook (and billing) must not depend on the ASR vendor.
 */
export async function maybeStartTranscript(consultation) {
  if (!isAsrEnabled() || !consultation?.zegoRoomId) return;
  const db = getDb();
  let transcript;
  try {
    transcript = await db.consultationTranscript.create({
      data: { consultationId: consultation.id, status: "starting", vendor: asrVendor() },
    });
  } catch (err) {
    if (err?.code === "P2002") return; // another callback already owns the start
    log.error(`[transcript] could not create row for consultation ${consultation.id}: ${err.message}`);
    return;
  }

  // Fire-and-forget: own catch, failure recorded on the row.
  runStart(transcript.id, consultation.id, consultation.zegoRoomId).catch((err) =>
    log.error(`[transcript] start crashed for consultation ${consultation.id}: ${err.message}`)
  );
}

async function runStart(transcriptId, consultationId, roomId) {
  const db = getDb();
  try {
    const { taskId } = await startAsrTask(roomId);
    await db.consultationTranscript.update({
      where: { id: transcriptId },
      data: { taskId, status: "active", startedAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
    });
    log.info(`[transcript] ASR started consultation=${consultationId} task=${taskId}`);

    // The call may have ended while the start request was in flight.
    const c = await db.consultation.findUnique({ where: { id: consultationId }, select: { status: true } });
    if (c && !["requested", "ringing", "accepted", "in_progress"].includes(c.status)) {
      await stopTranscript(consultationId);
    }
  } catch (err) {
    await db.consultationTranscript.update({ where: { id: transcriptId }, data: asrFailure(err) }).catch(() => {});
    log.warn(`[transcript] ASR start failed consultation=${consultationId} code=${err.code ?? "?"} msg=${err.message}`);
  }
}

/** Stops the ASR task for a consultation. Best effort; never throws. */
export async function stopTranscript(consultationId) {
  if (!isAsrEnabled()) return;
  const db = getDb();
  try {
    const transcript = await db.consultationTranscript.findUnique({ where: { consultationId } });
    if (!transcript || transcript.status !== "active" || !transcript.taskId) return;
    // Claim the stop so a second caller (real + simulated room_close) doesn't repeat it.
    const claimed = await db.consultationTranscript.updateMany({
      where: { id: transcript.id, status: "active" },
      data: { status: "stopped", stoppedAt: new Date() },
    });
    if (claimed.count === 0) return;
    try {
      await stopAsrTask(transcript.taskId);
    } catch (err) {
      // ZEGO also auto-stops an empty room (MaxIdleTime); keep the row stopped, note the error.
      await db.consultationTranscript.update({ where: { id: transcript.id }, data: { lastErrorCode: String(err.code ?? "ERROR").slice(0, 64), lastErrorMessage: String(err.message).slice(0, 500) } });
      log.warn(`[transcript] ASR stop failed consultation=${consultationId} code=${err.code ?? "?"}`);
    }
  } catch (err) {
    log.error(`[transcript] stop crashed consultation=${consultationId}: ${err.message}`);
  }
}

// ── Callback ingestion ──────────────────────────────────────────────────────

const pick = (obj, keys) => {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  return undefined;
};

/** ZEGO task-end notices that are not failures (see ingestAsrCallback). */
const BENIGN_EXCEPTION_CODES = new Set(["1202"]);

/** The callback `Data` schema is not fully documented, so read the likely field names. */
export function extractAsrResult(payload) {
  let data = payload?.Data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  data = data && typeof data === "object" ? data : {};
  const text = pick(data, ["Text", "text", "Content", "Result", "Sentence"]);
  const final = pick(data, ["IsFinal", "isFinal", "Final", "IsEnd", "EndFlag", "SentenceEnd", "IsSentenceEnd"]);
  const tsRaw = pick(data, ["Timestamp", "timestamp", "EndTime", "BeginTime"]) ?? payload?.Timestamp;
  const tsNum = Number(tsRaw);
  return {
    data,
    text: typeof text === "string" ? text.trim() : "",
    sentenceId: pick(data, ["SentenceId", "sentenceId", "Round", "SeqId", "SequenceId", "Index"]),
    streamId: pick(data, ["StreamId", "streamId"]),
    userId: pick(data, ["UserId", "userId", "UserAccount", "user_account"]),
    language: pick(data, ["Language", "language", "Lang"]),
    isFinal: final === undefined ? true : !(final === false || final === "false" || final === 0 || final === "0"),
    timestampMs: Number.isFinite(tsNum) ? Math.round(tsNum < 1e11 ? tsNum * 1000 : tsNum) : null,
  };
}

/**
 * Handles one verified ASR callback. Resolves to a short status string; THROWS only on a
 * database failure, so the route can answer 5xx and let ZEGO retry (writes are idempotent).
 */
export async function ingestAsrCallback(payload) {
  const db = getDb();
  const event = payload?.Event;

  const transcript =
    (payload?.TaskId && (await db.consultationTranscript.findUnique({ where: { taskId: String(payload.TaskId) } }))) ||
    (payload?.RoomId &&
      (await (async () => {
        const c = await db.consultation.findFirst({ where: { zegoRoomId: String(payload.RoomId) }, select: { id: true } });
        return c ? db.consultationTranscript.findUnique({ where: { consultationId: c.id } }) : null;
      })()));
  if (!transcript) return "no_transcript";

  if (event === "Exception") {
    const data = payload?.Data && typeof payload.Data === "object" ? payload.Data : {};
    const code = String(pick(data, ["Code", "ErrorCode", "code"]) ?? "EXCEPTION");
    // 1202 "RTC reach max idle time" is how ZEGO ends a task once the room goes quiet after the
    // call — a normal end, not a failure. Never downgrade an already-failed row either.
    if (BENIGN_EXCEPTION_CODES.has(code)) {
      await db.consultationTranscript.updateMany({
        where: { id: transcript.id, status: { in: ["starting", "active"] } },
        data: { status: "stopped", stoppedAt: new Date() },
      });
      return "ended";
    }
    await db.consultationTranscript.update({
      where: { id: transcript.id },
      data: {
        status: "failed",
        lastErrorCode: String(pick(data, ["Code", "ErrorCode", "code"]) ?? "EXCEPTION").slice(0, 64),
        lastErrorMessage: String(pick(data, ["Message", "Msg", "message"]) ?? "ASR reported an exception").slice(0, 500),
      },
    });
    return "exception";
  }
  if (event !== "ASRResult") return "ignored"; // TranslationResult etc. are not stored

  const r = extractAsrResult(payload);
  if (!r.text) {
    log.warn(`[transcript] ASRResult without text for consultation=${transcript.consultationId} dataKeys=${Object.keys(r.data).join(",")}`);
    return "no_text";
  }

  const consultation = await db.consultation.findUnique({
    where: { id: transcript.consultationId },
    include: { customer: { include: { user: true } }, expert: true },
  });
  const speakerRole = consultation ? resolveSpeakerRole(consultation, r.userId, r.streamId) : "unknown";

  // Without a sentence id every result would collide on one row; fall back to a content key.
  const sentenceId = String(r.sentenceId ?? `h:${crypto.createHash("sha1").update(`${r.timestampMs ?? ""}|${r.streamId ?? ""}|${r.text}`).digest("hex").slice(0, 24)}`).slice(0, 128);
  const streamId = String(r.streamId ?? "").slice(0, 256);
  const fields = {
    zegoUserId: r.userId == null ? null : String(r.userId).slice(0, 128),
    speakerRole,
    text: r.text,
    language: r.language == null ? null : String(r.language).slice(0, 32),
    isFinal: r.isFinal,
    zegoTimestampMs: r.timestampMs,
    raw: r.data,
  };

  try {
    await db.consultationTranscriptSegment.create({ data: { transcriptId: transcript.id, streamId, sentenceId, ...fields } });
    return "stored";
  } catch (err) {
    if (err?.code !== "P2002") throw err;
  }
  // Same sentence again: a partial may refine a partial, a final may replace anything,
  // but a late partial must never overwrite a final.
  const updated = await db.consultationTranscriptSegment.updateMany({
    where: { transcriptId: transcript.id, streamId, sentenceId, ...(r.isFinal ? {} : { isFinal: false }) },
    data: fields,
  });
  return updated.count > 0 ? "updated" : "stale";
}
