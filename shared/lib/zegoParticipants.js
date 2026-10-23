/**
 * Matching ZEGO room participants to a consultation's two parties.
 *
 * The Flutter app may join a room with the account (user) id or the profile id,
 * and hyphens may or may not be present, so every comparison goes through
 * normalizeId() and accepts either id.
 */
export const normalizeId = (id) => String(id ?? "").replace(/-/g, "").toLowerCase();

/** Consultation must include `customer.user` and `expert`. */
export function participantIds(consultation) {
  return {
    customer: [consultation.customer?.user?.id, consultation.customer?.id].filter(Boolean).map(normalizeId),
    expert: [consultation.expert?.userId, consultation.expert?.id].filter(Boolean).map(normalizeId),
  };
}

export function matchesCustomer(consultation, id) {
  const n = normalizeId(id);
  return Boolean(n) && participantIds(consultation).customer.includes(n);
}

export function matchesExpert(consultation, id) {
  const n = normalizeId(id);
  return Boolean(n) && participantIds(consultation).expert.includes(n);
}

/**
 * "customer" | "expert" | "unknown" for the first candidate that identifies a party.
 * A candidate may be a user id or a stream id that embeds one.
 */
export function resolveSpeakerRole(consultation, ...candidates) {
  const ids = participantIds(consultation);
  for (const candidate of candidates) {
    const n = normalizeId(candidate);
    if (!n) continue;
    if (ids.customer.includes(n)) return "customer";
    if (ids.expert.includes(n)) return "expert";
  }
  for (const candidate of candidates) {
    const n = normalizeId(candidate);
    if (!n) continue;
    if (ids.customer.some((id) => n.includes(id))) return "customer";
    if (ids.expert.some((id) => n.includes(id))) return "expert";
  }
  return "unknown";
}
