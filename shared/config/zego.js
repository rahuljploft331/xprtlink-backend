import { getSecretSync } from "./secrets.js";

/**
 * Load ZegoCloud credentials from environment.
 * Follows the existing getSecretSync() pattern used throughout the backend.
 *
 * @returns {{ appID: number, serverSecret: string }}
 * @throws {Error} If ZEGO_APP_ID or ZEGO_SERVER_SECRET are not set
 */
export function getZegoConfig() {
  const appID = Number(getSecretSync("ZEGO_APP_ID"));
  const serverSecret = getSecretSync("ZEGO_SERVER_SECRET");

  if (!appID || isNaN(appID)) {
    throw new Error("ZEGO_APP_ID must be set in .env (numeric App ID from ZegoCloud console)");
  }
  if (!serverSecret || serverSecret.length !== 32) {
    throw new Error("ZEGO_SERVER_SECRET must be a 32-character string set in .env");
  }

  return { appID, serverSecret };
}
