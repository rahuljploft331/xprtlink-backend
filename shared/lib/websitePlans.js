import { getDb } from "../db/getClient.js";

/**
 * Settings → "Show subscription plans on website". Default on; only an explicit
 * false (or the string "false") hides the website plan step.
 */
export function parseWebsitePlansEnabled(value) {
  return value !== false && value !== "false" && value !== 0;
}

export async function isWebsitePlansEnabled() {
  const row = await getDb().platformSetting.findUnique({ where: { key: "websitePlansEnabled" } });
  return parseWebsitePlansEnabled(row?.value);
}
