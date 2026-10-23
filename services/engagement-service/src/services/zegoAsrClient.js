import crypto from "node:crypto";
import { getZegoConfig } from "@xprtlink/shared/config/zego.js";

/**
 * ZEGO Cloud Real-time ASR server API (StartRealtimeASRTask / StopRealtimeASRTask).
 * Signature v2: md5(AppId + SignatureNonce + ServerSecret + Timestamp).
 *
 * Off by default — set ZEGO_ASR_ENABLED=true once ZEGO has enabled the service for the AppID
 * (until then the API answers 410000006 "app not enable").
 */
const DEFAULT_API_URL = "https://cloud-realtime-asr-api.zegotech.cn/";
const REQUEST_TIMEOUT_MS = 10_000;

export const isAsrEnabled = () => String(process.env.ZEGO_ASR_ENABLED ?? "").toLowerCase() === "true";

export class AsrApiError extends Error {
  constructor(message, { code, requestId } = {}) {
    super(message);
    this.name = "AsrApiError";
    this.code = code == null ? null : String(code);
    this.requestId = requestId ?? null;
  }
}

export function asrVendor() {
  return process.env.ZEGO_ASR_VENDOR || "Tencent";
}

function vendorParams() {
  const raw = process.env.ZEGO_ASR_PARAMS;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new AsrApiError("ZEGO_ASR_PARAMS is not valid JSON", { code: "CONFIG" });
  }
}

async function callAsrApi(action, body) {
  const { appID, serverSecret } = getZegoConfig();
  const nonce = crypto.randomBytes(8).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash("md5").update(`${appID}${nonce}${serverSecret}${timestamp}`).digest("hex");

  const url = new URL(process.env.ZEGO_ASR_API_URL || DEFAULT_API_URL);
  url.search = new URLSearchParams({
    Action: action,
    AppId: String(appID),
    SignatureNonce: nonce,
    Timestamp: String(timestamp),
    SignatureVersion: "2.0",
    Signature: signature,
  }).toString();

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AsrApiError(`ZEGO ASR request failed: ${err.name === "TimeoutError" ? "timeout" : err.message}`, { code: "NETWORK" });
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new AsrApiError(`ZEGO ASR returned a non-JSON response (HTTP ${res.status})`, { code: `HTTP_${res.status}` });
  }
  // ZEGO answers HTTP 200 for API-level failures; the Code field is the truth.
  if (json?.Code !== 0) {
    throw new AsrApiError(json?.Message || "ZEGO ASR error", { code: json?.Code ?? `HTTP_${res.status}`, requestId: json?.RequestId });
  }
  return json;
}

/** Starts recognition for every audio stream in the room. Resolves to the ZEGO TaskId. */
export async function startAsrTask(roomId) {
  const params = vendorParams();
  const body = {
    RoomId: roomId,
    RecognitionRange: 0,
    ASR: { Vendor: asrVendor(), ...(params ? { Params: params } : {}) },
    SubtitleType: Number(process.env.ZEGO_ASR_SUBTITLE_TYPE ?? 1),
    AdvancedConfig: { MaxIdleTime: Number(process.env.ZEGO_ASR_MAX_IDLE_SECONDS ?? 120) },
  };
  if (process.env.ZEGO_ASR_HOST_TAG) body.CallbackConfig = { HostTag: process.env.ZEGO_ASR_HOST_TAG };

  const json = await callAsrApi("StartRealtimeASRTask", body);
  const taskId = json?.Data?.TaskId;
  if (!taskId) throw new AsrApiError("ZEGO ASR start returned no TaskId", { code: "NO_TASK_ID", requestId: json?.RequestId });
  return { taskId: String(taskId), requestId: json.RequestId };
}

export async function stopAsrTask(taskId) {
  await callAsrApi("StopRealtimeASRTask", { TaskId: taskId });
}
