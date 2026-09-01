/** Convert Prisma Date to ISO-8601 string for API responses. */
export function toIso(date) {
  if (!date) return null;
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

/** Store money as integer cents in DB; expose as decimal units in API. */
export function centsToAmount(cents) {
  if (cents == null) return null;
  return Number(cents) / 100;
}

/** Accept API decimal amount; persist as cents. */
export function amountToCents(amount) {
  if (amount == null) return null;
  return Math.round(Number(amount) * 100);
}

/** Build a display name from first/last name parts. */
export function fullName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

/**
 * Customer display name.
 * @param {object} customerUser - The User row.
 * @param {object|null} [customerProfile] - The CustomerProfile row (if available separately).
 *   When present, first_name/last_name from the profile are used (most accurate).
 *   Falls back to email prefix only as a last resort.
 */
export function customerDisplayName(customerUser, customerProfile) {
  if (!customerUser && !customerProfile) return "Customer";
  // Prefer the explicit customerProfile argument (passed by quote/consultation mappers).
  const profile = customerProfile ?? customerUser?.customerProfile ?? null;
  if (profile) {
    const name = fullName(profile.firstName, profile.lastName);
    if (name) return name;
  }
  return customerUser?.email?.split("@")[0] ?? "Customer";
}

/** Resolve media URL from storage key (placeholder until S3 wiring). */
export function resolveMediaUrl(storageKey) {
  if (!storageKey) return null;
  const base = process.env.MEDIA_PUBLIC_BASE_URL || "";
  return base ? `${base.replace(/\/$/, "")}/${storageKey}` : `/${storageKey}`;
}
