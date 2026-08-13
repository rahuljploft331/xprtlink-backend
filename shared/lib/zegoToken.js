import { generateToken04 } from "./zegoServerAssistant.js";
import { getZegoConfig } from "../config/zego.js";

/**
 * Generate a ZegoCloud Token04 for a user to join a video room.
 *
 * Used by the engagement-service when a participant requests a video token
 * for a consultation. The Flutter UIKit needs: token, appID, roomId.
 *
 * @param {string} userId  - Unique user identifier (our internal userId)
 * @param {string} roomId  - The Zego room ID (consultation.zegoRoomId)
 * @param {number} [effectiveSeconds=3600] - Token TTL in seconds (default 1 hour)
 * @returns {{ token: string, appID: number, roomId: string, expiresAt: Date }}
 */
export function generateZegoToken(userId, roomId, effectiveSeconds = 3600) {
  const { appID, serverSecret } = getZegoConfig();

  // Privilege payload: allow login + publish stream in the specified room
  const payload = JSON.stringify({
    room_id: roomId,
    privilege: {
      1: 1, // PrivilegeKeyLogin: Enable
      2: 1, // PrivilegeKeyPublish: Enable
    },
    stream_id_list: null,
  });

  const token = generateToken04(
    appID,
    userId,
    serverSecret,
    effectiveSeconds,
    payload
  );

  return {
    token,
    appID,
    roomId,
    expiresAt: new Date(Date.now() + effectiveSeconds * 1000),
  };
}
