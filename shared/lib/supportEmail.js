import { getDb } from "../db/getClient.js";

export const DEFAULT_SUPPORT_EMAIL = "support@xpertlink.com";

/** Support address from Settings → Support email; falls back to the default. Never throws. */
export async function getSupportEmail() {
  try {
    const row = await getDb().platformSetting.findUnique({ where: { key: "supportEmail" } });
    const v = row?.value;
    const email = typeof v === "string" ? v : v?.email;
    return typeof email === "string" && email.includes("@") ? email : DEFAULT_SUPPORT_EMAIL;
  } catch {
    return DEFAULT_SUPPORT_EMAIL;
  }
}

/** HTML snippet: a mailto link to the support address. */
export function supportLinkHtml(email) {
  return `<a href="mailto:${email}" style="color:inherit;font-weight:600;text-decoration:underline">${email}</a>`;
}
