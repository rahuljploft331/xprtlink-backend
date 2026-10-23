import express, { Router } from "express";
import { verifyZegoSignature } from "@xprtlink/shared/lib/zegoWebhook.js";
import { verifyZegoAsrSignature } from "@xprtlink/shared/lib/zegoAsrWebhook.js";
import { ingestAsrCallback } from "../services/transcriptService.js";
import * as svc from "../services/zegoCallbackService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { logger } from "@xprtlink/shared/lib/logger.js";
const log = logger.child({ module: "webhooks.routes" });


const router = Router();

/**
 * POST /api/v1/engagement/webhooks/zego
 *
 * ZegoCloud server callback endpoint.
 * This is the URL you enter in the ZegoCloud Console → Callback Setup.
 *
 * No JWT auth — verified via ZegoCloud's CallbackSecret signature instead.
 * Must return 200 quickly or ZegoCloud will retry (2s, 4s, 8s, 16s, 32s).
 */
router.post(
  "/zego",
  async (req, res) => {
    const { event, signature, timestamp, nonce } = req.body;

    // 1. Verify signature
    if (!verifyZegoSignature(signature, timestamp, nonce)) {
      log.warn("[zego-webhook] Invalid signature, rejecting callback");
      return res.status(401).json({ code: 1, message: getMessage("invalidSignature") });
    }

    // 2. Log every callback for debugging
    log.info(`[zego-webhook] event=${event} room=${req.body.room_id || "N/A"}`);

    // 3. Dispatch to handler — always return 200 to ZegoCloud first
    //    (process async to avoid timeout retries)
    try {
      await svc.handleZegoCallback(req.body);
    } catch (err) {
      // Log but don't fail — ZegoCloud must get 200
      log.error({ err: err.message }, "[zego-webhook] handler error:");
    }

    // ZegoCloud expects { code: 0 } for success
    return res.status(200).json({ code: 0 });
  }
);

/**
 * ZEGO sends the ASR callback JSON "UrlDecode"-able, and which Content-Type it uses is not
 * documented, so accept an object body, a JSON/percent-encoded string, or a urlencoded form
 * whose only key is the JSON text. Anything else comes back as {}.
 */
function coerceCallbackBody(body) {
  const parse = (text) => {
    for (const candidate of [text, (() => { try { return decodeURIComponent(text); } catch { return null; } })()]) {
      if (!candidate) continue;
      try {
        const v = JSON.parse(candidate);
        if (v && typeof v === "object") return v;
      } catch { /* try next */ }
    }
    return null;
  };
  if (typeof body === "string") return parse(body) ?? {};
  if (body && typeof body === "object") {
    if (body.Event) return body;
    const keys = Object.keys(body);
    if (keys.length === 1) return parse(keys[0]) ?? {};
  }
  return {};
}

/**
 * GET/HEAD /api/v1/engagement/webhooks/zego-asr
 * Reachability probe: ZEGO checks a callback address with a plain GET when it is registered,
 * and a 404 here looks like a dead URL. Returns nothing sensitive.
 */
router.all("/zego-asr", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return res.status(200).json({ code: 0 });
  return next();
});

/**
 * POST /api/v1/engagement/webhooks/zego-asr
 *
 * ZEGO Cloud Real-time ASR results (give this URL to ZEGO support to register).
 * Verified by the callback-secret signature (no JWT). Unlike the room route this returns
 * 5xx when the database write fails so ZEGO's retries (2s…32s) can recover it — writes are
 * idempotent. Unknown events/rooms answer 200. Payloads contain call content: never log them.
 */
router.post(
  "/zego-asr",
  express.text({ type: ["text/*"], limit: "1mb" }),
  async (req, res) => {
    const payload = coerceCallbackBody(req.body);
    const sigOk = verifyZegoAsrSignature(payload);

    // Structure-only diagnostics so the real ZEGO request shape can be confirmed: field NAMES and
    // types, never values (the Text is call content). Safe to keep; one short line per callback.
    const data = payload?.Data && typeof payload.Data === "object" ? payload.Data : null;
    const rawType = typeof req.body === "string" ? "string" : Array.isArray(req.body) ? "array" : typeof req.body;
    const tsNum = Number(payload?.Timestamp);
    log.info(
      `[zego-asr] recv method=${req.method} contentType=${req.headers["content-type"] ?? "none"} bodyType=${rawType} ` +
      `event=${payload?.Event ?? "none"} taskId=${payload?.TaskId ?? "none"} sigOk=${sigOk} ` +
      `tsSkewSec=${Number.isFinite(tsNum) ? Math.round((Date.now() - (tsNum < 1e11 ? tsNum * 1000 : tsNum)) / 1000) : "n/a"} ` +
      `keys=[${Object.keys(payload ?? {}).join(",")}] dataKeys=[${data ? Object.entries(data).map(([k, v]) => `${k}:${typeof v}`).join(",") : (payload?.Data === undefined ? "none" : typeof payload.Data)}]`
    );

    if (!sigOk) {
      log.warn("[zego-asr] Invalid signature, rejecting callback");
      return res.status(401).json({ code: 1, message: getMessage("invalidSignature") });
    }

    try {
      const outcome = await ingestAsrCallback(payload);
      log.info(`[zego-asr] event=${payload.Event} task=${payload.TaskId ?? "N/A"} outcome=${outcome}`);
      return res.status(200).json({ code: 0 });
    } catch (err) {
      log.error({ err: err.message }, "[zego-asr] failed to store callback");
      return res.status(500).json({ code: 1 });
    }
  }
);

export default router;
