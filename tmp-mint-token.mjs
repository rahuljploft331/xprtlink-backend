// Temp helper: mint a fresh expert access token for Postman collection run.
// Uses the backend's own JWT signing so the token is accepted by the gateway.
import { getDb } from "@xprtlink/shared/db";
import { signAccessToken } from "@xprtlink/shared/auth/jwt.js";
import { loadSecret } from "@xprtlink/shared/config/secrets.js";

// Populate the secrets cache (AWS Secrets Manager → JWT_SECRET) before signing.
await loadSecret();

const db = getDb();

// Reuse the expert that the old local env token referenced, else pick any expert.
const preferredUserId = "164e170a-b4fc-4a55-8139-3dfc298bba86";

let expert = await db.expertProfile.findFirst({
  where: { userId: preferredUserId },
  include: { user: true },
});

if (!expert) {
  expert = await db.expertProfile.findFirst({ include: { user: true } });
}

if (!expert) {
  console.error("NO_EXPERT_FOUND");
  process.exit(1);
}

const token = signAccessToken({
  sub: expert.userId,
  role: "expert",
  expertProfileId: expert.id,
  customerProfileId: null,
});

console.log(JSON.stringify({
  userId: expert.userId,
  expertProfileId: expert.id,
  email: expert.user?.email ?? null,
  token,
}));
process.exit(0);
