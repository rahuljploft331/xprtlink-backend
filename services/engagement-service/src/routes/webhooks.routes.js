import { Router } from "express";
import { verifyZegoSignature } from "@xprtlink/shared/lib/zegoWebhook.js";
import * as svc from "../services/zegoCallbackService.js";

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
      console.warn("[zego-webhook] Invalid signature, rejecting callback");
      return res.status(401).json({ code: 1, message: "Invalid signature" });
    }

    // 2. Log every callback for debugging
    console.log(`[zego-webhook] event=${event} room=${req.body.room_id || "N/A"}`);

    // 3. Dispatch to handler — always return 200 to ZegoCloud first
    //    (process async to avoid timeout retries)
    try {
      await svc.handleZegoCallback(req.body);
    } catch (err) {
      // Log but don't fail — ZegoCloud must get 200
      console.error("[zego-webhook] handler error:", err.message);
    }

    // ZegoCloud expects { code: 0 } for success
    return res.status(200).json({ code: 0 });
  }
);

export default router;
