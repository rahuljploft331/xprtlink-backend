# XprtLink Backend Audit — Node.js / PostgreSQL / Prisma (microservices)

Repo audited: `rahuljploft331/xprtlink-backend` (10 Express services + `shared` workspace, Prisma/Postgres, Stripe, ZegoCloud, Firebase, Twilio).

---

## Executive Summary

**Overall backend quality: C-**

The application has clearly been through prior hardening passes (partial unique indexes for soft-deleted users, FK `RESTRICT` on financial tables, idempotency indexes on Stripe/subscription IDs) — this is not a first draft. But several **critical authentication/authorization gaps** and **at least one payments data-integrity bug** remain, some of them explicitly flagged as unfinished in the code's own comments.

| Severity | Count |
|---|---|
| Critical | 7 |
| High | 9 |
| Medium | 10 |
| Low | 5 |
| **Total** | **31** |

### Top 5 most dangerous problems
1. **Internal service-to-service endpoints are protected only by checking that a header exists** (`x-internal-service`), not its value — and the "secret" value is a hardcoded string (`"true"` / `"engagement-service"`) baked into the public source. Anyone can call `POST /billing/consultations/:id/capture` and force a Stripe capture on a customer's held payment, or read any consultation's commission breakdown.
2. **Suspended/deleted/banned users are never actually locked out.** `authenticate()` only checks the JWT signature; `refresh()` and `issueTokens()` never re-check `user.status` against the DB. A banned user keeps refreshing new access tokens forever.
3. **Password reset and change-password never revoke existing sessions.** If an account is compromised and the owner "resets" their password to reclaim it, the attacker's existing refresh token and access token keep working.
4. **Two-step registration marks the email verified even when only the phone channel was used** (and vice versa is *not* true — only the email→phone direction is broken). This lets anyone register and permanently "claim" an email address they don't own, using only a phone number they control.
5. **Expert bank-account payouts are wired to a fake Stripe account ID.** `ExpertProfile.stripeAccountId` doesn't exist in the Prisma schema; the real Connect account ID from KYC is generated but never saved, so `attachBankAccount` silently falls back to `acct_stub_<uuid>`.

### Top 5 most embarrassing/basic bugs
1. `services/billing-service/src/routes/billing.routes.js` — `/subscriptions/expire` has a comment literally reading *"Protect this in production with an internal secret header... "* directly above code that does no such thing. It's a fully open, unauthenticated, data-mutating endpoint.
2. `shared/config/secrets.js` defines `SERVICE_SECRET` and `scripts/env-check.js` lists it as "recommended" — but it is **never read or checked anywhere** in the codebase. The internal-auth mechanism was scaffolded and never finished.
3. `shared/auth/otp.js#verifyOtpCode` unconditionally `console.log`s the user's submitted OTP code and the hardcode-bypass config on every phone verification attempt — in production, not just dev.
4. `shared/middleware/errorHandler.js` only logs 500 errors when `NODE_ENV !== "production"` — i.e., **production has zero server-side error logging**, exactly backwards from what you want.
5. No `CHECK` constraint exists anywhere in the database (`grep -r CHECK migrations/` returns nothing) — not on `Review.rating` (1–5), not on any `*Cents` money column, not on `expMonth`/`expYear`. Every invariant lives only in Zod, so a Prisma raw query, a script, or a future engineer bypassing the service layer can write negative money or a rating of 999.

---

## Findings Table

| Severity | Location | Problem | Why it matters | Recommended fix |
|---|---|---|---|---|
| Critical | `userService.js#verifyOtp` (purpose=register) | Sets `emailVerifiedAt` **and** `phoneVerifiedAt` regardless of which OTP channel was actually verified | Account/email squatting — attacker can claim any email via phone-only verification | Only stamp the channel actually verified; require separate verification for the other |
| Critical | `shared/auth/tokens.js#refresh`, `issueTokens` | Never re-checks `user.status` from DB | Suspended/deleted/banned accounts keep working indefinitely via refresh | Check `user.status === 'active'` in `refresh()` and reject otherwise |
| Critical | `userService.js#resetPassword`, `#changePassword` | Never revokes existing refresh tokens/sessions | Attacker session survives a "successful" password reset | Revoke all refresh tokens + auth sessions for the user on password change/reset |
| Critical | `billing.routes.js` `/consultations/:id/capture`, `/consultations/:id/charge` | "Internal-only" guard is `if (!req.headers['x-internal-service'])` — any non-empty value passes, and the actual value used (`internalFetch.js`) is a hardcoded public string | Unauthenticated attacker can trigger Stripe captures or read commission data for any consultation | Validate a real shared secret (`SERVICE_SECRET`, HMAC, or mTLS/network isolation), not header presence |
| Critical | `billingService.js#attachBankAccount` | Reads `expert.stripeAccountId`, a field that doesn't exist on `ExpertProfile` in `schema.prisma` | Always falls back to `acct_stub_<uuid>`; the real Connect account ID from `submitCustomConnectKyc` is never persisted | Add `stripeAccountId` column to `ExpertProfile`, persist it in `submitCustomConnectKyc`, use it here |
| Critical | `shared/auth/tokens.js#revokeRefreshToken`, `userService.js#refresh` | Scans only the most-recent 200 valid refresh tokens **system-wide** (not per-user) with a `bcrypt.compare` loop | Once the platform has >200 concurrently valid sessions, `logout()` silently fails to revoke older tokens (reports success anyway) and `refresh()` throws "Invalid refresh token" for legitimate users | Look up by a fast indexed lookup (e.g., store a SHA-256 lookup key or embed the token's own row id), scoped correctly; don't rely on being in the last 200 rows |
| Critical | `billingService.js#getTransaction` | If `tx.consultationCharge` is null (all `type: "subscription"` transactions), falls through to `else if (auth.role !== "expert" && auth.role !== "customer")` — true for *any* logged-in user | IDOR: any authenticated customer or expert can read any other user's subscription transaction (amount, metadata, expertProfileId) by guessing/enumerating transaction IDs | Require the transaction's `metadata.expertProfileId`/`customerProfileId` to match the caller for every transaction type, not just consultation-charge-linked ones |
| High | `billing.routes.js` `/subscriptions/expire` | Fully unauthenticated cron endpoint; comment admits it needs protection that was never added | Anyone can trigger subscription-expiry sweeps at will | Require `SERVICE_SECRET`/internal auth or bind to localhost only |
| High | `userService.js#sendOtp` / `#forgotPassword` | Never checks whether an account exists for the given email/phone before sending a real OTP | Unauthenticated SMS/email bombing of arbitrary numbers/addresses (cost + harassment); only defense is a 60s per-identifier cooldown | Rate-limit by identifier (not just IP), consider CAPTCHA on repeated triggers, cap total sends/identifier/day |
| High | `services/admin-service/.../auth.routes.js` + `api-gateway/server.js` | Admin login only hits the generic `defaultRateLimiter` (100/15min); the strict `authRateLimiter` (10/15min) is scoped to `/api/v1/auth` (user-service) only | Weakest brute-force protection sits on the most sensitive login surface | Apply `authRateLimiter` to `/api/v1/admin/auth` too |
| High | `shared/auth/otp.js#verifyOtpCode` | Unconditional `console.log("[DEBUG] Verify Twilio:", { inputCode: code, hardcodeCode: process.env.OTP_HARDCODE_CODE, ... })` | Leaks user-submitted verification codes and bypass config into production logs on every phone OTP attempt | Delete the debug log or gate it strictly behind `NODE_ENV !== 'production'` and never log the raw code |
| High | `shared/middleware/errorHandler.js` | `console.error(err)` only runs when `NODE_ENV !== "production"`; no Prisma-error normalization anywhere (`grep P2002` = 0 hits) | Production has no server-side error logs; unhandled Prisma errors (e.g. unique-constraint races) leak raw Prisma messages to clients as HTTP 500 | Always log 5xx server-side (to stdout/monitoring); add explicit Prisma error mapping (P2002→409, P2025→404, etc.) |
| High | `userService.js#verifyOtp` (verify_email/verify_phone branch) | `db.user.updateMany({ where: { email } , ... })` / `{ phone }` — not scoped to `challenge.userId` | Because email/phone uniqueness is only a *partial* index (excludes soft-deleted rows), a deleted user sharing the identifier can be touched by the same update | Scope to `where: { id: challenge.userId }` |
| High | `userService.js#register`, `#assertIdentifierAvailable` | `assertIdentifierAvailable` excludes `pending_verification` rows; the later `pending` lookup matches `OR:[{email},{phone}]` and overwrites **both** fields even if only one matched | Enables the email-squatting flow in Critical #1: attacker registers with victim's email + attacker's own phone, verifies by phone only, and the account becomes active/"email verified" | Match strictly by the pair intended to be resumed; re-validate both identifiers belong to the same in-flight signup before overwriting |
| High | `shared/config/serviceTemplate.js#getCorsOriginValidator` | Any request is allowed whenever `process.env.NODE_ENV !== "production"` (not just when Origin is absent) | Any staging/test deployment that forgets to set `NODE_ENV=production` opens full cross-origin access with `credentials: true` | Gate solely on the origin allowlist; use a separate `ALLOW_ALL_CORS` flag for local dev, not `NODE_ENV` |
| High | `services/media-service/src/services/mediaService.js#getMediaAsset` | Hard 403s unless `asset.ownerUserId === auth.userId` | As written, the *other* participant in a chat/quote (or a customer viewing an expert's avatar) can never fetch a media asset they don't own, even though these assets are inherently meant to be viewed by a counterparty | Confirm real read path for cross-user assets (chat/quote attachments, avatars); if this endpoint is genuinely used for that, add relationship-based authorization, not owner-only |
| Medium | `shared/prisma/schema.prisma` + all migrations | Zero `CHECK` constraints anywhere (verified via `grep -r CHECK` across all migrations) | `Review.rating`, every `*Cents` column, `expMonth`/`expYear`, `experienceYears`, `ratingAvg` all rely solely on app-layer Zod validation | Add `CHECK` constraints via raw SQL migrations for the invariants Zod already encodes |
| Medium | `shared/auth/tokens.js#refresh` | `resolvedRole = role \|\| (customerProfile ? "customer" : ...)` | If the client omits `role` on refresh and the user has both profiles, role silently defaults to `customer`, changing the session's effective role without warning | Persist the originating role on the `RefreshToken` row and require it to match on refresh, or make `role` mandatory |
| Medium | `shared/config/serviceTemplate.js` (`express.json({limit:"100mb"})`) + `mediaService.js#directUpload` | 100MB body limit applied globally to every route in every service (auth included); `directUpload` (if ever wired to a route) does zero size/mime validation for non-`chat_attachment` purposes | Trivial memory-exhaustion DoS surface, worst on services with no rate limiting when hit directly (bypassing the gateway) | Set tight, endpoint-specific body limits; validate size/mime for every media purpose, not just chat attachments |
| Medium | `shared/lib/zegoWebhook.js#verifyZegoSignature` | Signs only `{secret, timestamp, nonce}` — never the event body itself (`event`, `room_id`, `id_name`); no nonce-replay tracking | If a valid `(timestamp, nonce, signature)` triple is ever observed, it can be replayed with an arbitrary `event`/`room_id` and still pass verification | Confirm this matches ZegoCloud's actual current spec; add a nonce-seen store and sanity-check `room_id` against expected state regardless |
| Medium | `shared/utils/errors.js` usage across `userService.js`, `billingService.js`, `engagementService.js` | `conflict()` (409) helper exists but `EMAIL_TAKEN`, `PHONE_TAKEN`, `ALREADY_PAID`, `REVIEW_EXISTS` all use `badRequest()` (400) instead | Inconsistent HTTP status codes for genuinely-409 "this already exists / already happened" states | Use `conflict()` for all already-exists / already-done error paths |
| Medium | `services/user-service/.../auth.routes.js#check-availability` | Fully unauthenticated endpoint that directly answers "does this email/phone exist" | Explicit enumeration oracle with no per-identifier throttle beyond the general IP limiter | Add stricter, identifier-scoped rate limiting; consider generic responses + CAPTCHA after N calls |
| Medium | `userService.js#login` | For email+password login, `verifyPassword` (bcrypt.compare, ~100ms) only runs if a user row was found; a nonexistent email returns instantly | Timing side-channel enables user enumeration | Always run a dummy bcrypt.compare against a fixed hash when no user is found |
| Medium | `services/admin-service/.../auth.controller.js#logout` | Comment: *"stateless JWT; just acknowledge"* — no server-side revocation exists for admin tokens at all | A stolen/leaked admin JWT stays valid for its full lifetime (default 7d) even after "logout" | Add a minimal admin session/refresh-token table, or at least a short admin token TTL + refresh flow |
| Medium | `engagementService.js#createConsultation` | No check on `expert.verificationStatus`/`availabilityStatus`; no idempotency guard against duplicate submissions | Customers can request consultations with unverified/offline experts; retried/double-submitted requests create duplicate `requested` rows | Validate expert eligibility; add a short-lived idempotency key or a partial unique index on `(customerId, expertId, status)` for active requests |
| Medium | `.env.example#DATABASE_URL`, `shared/db/getClient.js` | No `connection_limit` set; ~10 services each open an independent Prisma pool against one Postgres instance | Currently mitigated by `instances: 1` fork mode in `ecosystem.config.cjs`, but a latent connection-exhaustion risk the moment any service scales horizontally | Set explicit `connection_limit`/`pool_timeout` on `DATABASE_URL`, or front Postgres with PgBouncer |
| Low | `mediaService.js#directUpload` | Defined, exported, never routed or called anywhere (`grep -rn directUpload` = only its own definition) | Dead code; also lacks purpose-based validation if it were ever wired up | Remove, or finish wiring it with the same validation as `createUpload` |
| Low | `shared/middleware/auth.js#authenticate` | `console.error("[Auth] Token verification failed:", err)` runs unconditionally for every invalid/expired token | Log noise at scale; expired tokens are an expected, routine occurrence, not an error | Log at `debug`/`info` level, or only log unexpected error types |
| Low | Every paginated list endpoint (`parsePagination`/`paginatedResult`) | Pure offset (`skip`/`take`) pagination throughout, no cursor option | Deep pages (`page=5000`) degrade under `OFFSET` scans as tables grow | Offer cursor-based pagination for high-volume endpoints (notifications, transactions, consultations) |
| Low | `engagementService.js#getVideoToken` | Allows Zego token issuance while status is still `"requested"` (before expert acceptance) | Minor state-machine looseness; still gated by participant ownership, so low impact | Restrict to `["accepted","in_progress","ringing"]` |
| Low | `shared/auth/tokens.js#getRefreshTokenExpiresAt`, `jwt.js` defaults | Accepts `"never"/"infinite"/"forever"/"none"` as valid `REFRESH_TOKEN_EXPIRES_IN`, issuing 100-year tokens; access tokens default to 7 days | Configuration footgun — an accidental/typo'd env value could produce effectively-permanent sessions | Remove the "infinite" options, or require an explicit, separately-flagged opt-in |

---

## Detailed Findings

### CRITICAL

---

**C1 — Broken email verification lets attackers squat any email address**
**Severity:** Critical **Confidence:** High
**Location:** `services/user-service/src/services/userService.js`, function `verifyOtp`, `purpose === "register"` branch (~line 353)

**Problem:**
```js
await tx.user.update({
  where: { id: challenge.userId },
  data: {
    status: "active",
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: new Date(),
  },
});
```
Registration requires both `email` and `phone` (`registerRequestSchema`), but only **one** OTP channel is actually used (`otpChannel`, default `"phone"`). Verifying that single OTP stamps *both* `emailVerifiedAt` and `phoneVerifiedAt`, regardless of which channel the code was actually delivered to.

**Failure scenario:** Attacker calls `POST /auth/register` with `email: victim@example.com`, `phone: <attacker's own number>`, `otpChannel: "phone"`. They receive and verify the SMS OTP on their own phone. The account activates as `status: active`, `emailVerifiedAt` set — despite the attacker never receiving or proving control of `victim@example.com`. `assertIdentifierAvailable`'s `claimedAvailabilityFilter` excludes `pending_verification`/`deleted` users, so once this account is `active`, the real victim's future registration attempt with their own email fails with `EMAIL_TAKEN`.

**Impact:** Permanent account/email squatting; victim locked out of ever registering with their own email; attacker holds an active account they fully control with a password of their choosing, "verified" email they don't own.

**Fix:** Only stamp the field for the channel actually verified. Send a separate verification OTP for the other channel and require both before treating an identifier as "verified" for anything security-sensitive (password reset target, etc.).

**Regression test:** Register with `otpChannel: "phone"`; verify; assert `emailVerifiedAt` is `null`. Only after also verifying an email OTP should `emailVerifiedAt` be set.

---

**C2 — Suspended/deleted users retain full API access via `refresh()`**
**Severity:** Critical **Confidence:** High
**Location:** `shared/auth/tokens.js`, functions `refresh` (in `userService.js`) and `issueTokens`/`resolveRoleContext`

**Problem:** `authenticate()` middleware only verifies the JWT signature/expiry — it never touches the DB. The *only* places that check `user.status` are `login()` and `getSession()`. `refresh()` fetches the refresh-token row (with its `user` include) and calls `issueTokens(row.user, resolvedRole)` — `issueTokens`/`resolveRoleContext` never check `user.status`.

**Failure scenario:** Admin suspends or "deletes" (soft-delete) a user (`status: 'suspended'`/`'deleted'`). The user's existing access token still works normally until it expires (up to 7 days). Worse — they can call `POST /auth/refresh` and receive a **brand-new** access token + refresh token, indefinitely, because `refresh()` never checks status. A ban is therefore not actually enforced except at the login screen.

**Impact:** Suspensions/bans are cosmetic. A banned user (harassment, fraud, ToS violation, chargebacks) keeps full account access as long as they keep refreshing.

**Fix:** In `refresh()`, after loading `row.user`, reject if `user.status !== 'active'` (revoke the token too). Same check belongs in any long-lived session validation path.

**Regression test:** Suspend a user with an existing valid refresh token; call `/auth/refresh`; expect 401, not new tokens.

---

**C3 — Password reset/change does not revoke existing sessions**
**Severity:** Critical **Confidence:** High
**Location:** `userService.js#resetPassword` (~line 421), `userService.js#changePassword` (~line 444)

**Problem:** Both functions update `passwordHash` but never touch `RefreshToken`/`AuthSession` rows for that user.

**Failure scenario:** Attacker compromises an account and is logged in with a valid refresh token. Victim notices and uses "forgot password" to reset it. Victim assumes this "kicks out" the attacker. It does not — the attacker's refresh token is still `revokedAt: null`, `expiresAt` still in the future (default 30d, or effectively forever if `REFRESH_TOKEN_EXPIRES_IN` is misconfigured to `"never"`), so they can keep calling `/auth/refresh` and remain logged in.

**Impact:** Account-recovery flows don't actually recover the account from an attacker's persistent access.

**Fix:** On both password reset and password change, revoke all `RefreshToken`/`AuthSession` rows for `userId` (`revokedAt: new Date()` in bulk) inside the same transaction.

**Regression test:** Issue tokens, then reset password; assert the old refresh token no longer works on `/auth/refresh`.

---

**C4 — Internal-only billing endpoints are trivially bypassable**
**Severity:** Critical **Confidence:** High
**Location:** `services/billing-service/src/routes/billing.routes.js` (`/consultations/:id/capture`, `/consultations/:id/charge`); `shared/lib/internalFetch.js`

**Problem:**
```js
const internalHeader = req.headers["x-internal-service"];
if (!internalHeader) {
  return res.status(403).json({ ... });
}
```
This accepts **any non-empty value** for the header — it is never compared against a known secret. Compounding this, the "internal" caller (`internalFetch.js`) sends a hardcoded literal: `{ "x-internal-service": "true" }`, and the direct fetch in `zegoCallbackService.js` sends `"x-internal-service": "engagement-service"`. Neither is a secret — both are public, static strings visible in this very source tree. A `SERVICE_SECRET` env var is defined in `shared/config/loadEnv.js` and listed in `scripts/env-check.js`, but it is **never read by any guard**.

**Failure scenario:** Any unauthenticated caller sends:
```
POST /api/v1/billing/consultations/<any-consultation-id>/capture
x-internal-service: x
Content-Type: application/json

{ "durationSeconds": 999999 }
```
`captureConsultation()` runs with attacker-supplied `durationSeconds`, computing `amountCents` from it and calling `stripeSvc.capturePaymentIntent` against that consultation's real held PaymentIntent — no ownership/authentication required at all. The paired GET endpoint discloses commission/expert-share breakdowns for any consultation ID the same way.

**Impact:** Unauthenticated financial manipulation (force-capturing holds with attacker-chosen duration/amount) and financial data disclosure for arbitrary consultations.

**Fix:** Compare the header against `SERVICE_SECRET` (or better, HMAC-sign internal requests, or restrict these routes to a private network/mTLS). At minimum: `if (internalHeader !== getSecretSync('SERVICE_SECRET')) return 403`.

**Regression test:** Call both endpoints with a bogus header value from an external client; expect 403. Call with the correct secret; expect success.

---

**C5 — Expert payouts wired to a non-existent Stripe account ID**
**Severity:** Critical **Confidence:** High
**Location:** `services/billing-service/src/services/billingService.js#attachBankAccount` (~line 409–428); `services/billing-service/src/services/billingService.js#submitCustomConnectKyc` (~line 380–407); `shared/prisma/schema.prisma` (`model ExpertProfile`)

**Problem:**
```js
// submitCustomConnectKyc — creates the real account, never saves account.id anywhere:
const account = await stripeSvc.createCustomConnectAccount({ ... });
return { expertProfileId: auth.expertProfileId, stripeAccountId: account.id, kycStatus: "submitted" };

// attachBankAccount — reads a field that doesn't exist:
const expert = await db.expertProfile.findUnique({ where: { id: auth.expertProfileId } });
...
stripeAccountId: expert.stripeAccountId || `acct_stub_${auth.expertProfileId}`,
```
`ExpertProfile` in `schema.prisma` has no `stripeAccountId` column at all (confirmed by full-schema review and `grep`). `expert.stripeAccountId` is therefore always `undefined`, so every bank-account attachment silently uses the `acct_stub_...` fallback — a Stripe account ID that was never actually created via the Stripe API.

**Failure scenario:** Expert completes KYC (real Stripe Custom Connect account created), then attaches their bank account. The bank account gets attached to a fake `acct_stub_<uuid>` "account" instead of the real one Stripe just created. In live mode this call would fail outright against Stripe (404); if it partially "succeeds" against a test/mocked Stripe, payouts have no working destination account at all.

**Impact:** Expert payout onboarding is fundamentally broken — money owed to experts cannot be transferred to their real Connect account.

**Fix:** Add `stripeAccountId String? @map("stripe_account_id")` to `ExpertProfile`; persist `account.id` at the end of `submitCustomConnectKyc`; use the real column in `attachBankAccount` (and fail loudly, not with a stub fallback, if it's missing).

**Regression test:** Run KYC submission, assert `ExpertProfile.stripeAccountId` is populated; run bank-account attach, assert the Stripe call receives that real ID, not a stub.

---

**C6 — Refresh-token lookup doesn't scale and silently breaks logout/refresh**
**Severity:** Critical **Confidence:** High
**Location:** `shared/auth/tokens.js#revokeRefreshToken`; `userService.js#refresh`

**Problem:** Both functions load `db.refreshToken.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, take: 200, orderBy: { createdAt: 'desc' } })` — **not filtered by user** — then loop, calling `bcrypt.compare` against each row's `tokenHash` to find a match.

**Failure scenario:** Once the platform has more than 200 concurrently-valid refresh tokens system-wide (trivial at any real scale, or even in a busy QA/staging environment), any session whose token isn't among the 200 most-recently-issued becomes unreachable by this scan:
- `logout()` calls `revokeRefreshToken()`, which returns `null` if no match is found — and `logout()` doesn't check the return value, so the client is told "logged out" (200 OK) while the token remains fully valid and unrevoked.
- `refresh()` throws `unauthorized("Invalid refresh token")` for a perfectly valid, unexpired token simply because it's "old" relative to the most recent 200 issued anywhere on the platform, forcing an unnecessary full re-login.

Additionally, using `bcrypt.compare` (intentionally slow, ~100ms) against up to 200 candidates per call is expensive by design for what is a high-entropy random token (`crypto.randomBytes(48)`), not a low-entropy password — bcrypt provides no benefit here over a fast, indexed lookup and materially increases request latency and CPU cost.

**Impact:** Logout silently doesn't work at scale (security issue: sessions can't actually be terminated by the user); refresh silently fails for legitimate long-lived sessions once >200 tokens are outstanding platform-wide (correctness/availability issue).

**Fix:** Store a fast, indexable lookup value (e.g., SHA-256 of the token, or split the token into a public "selector" + secret "verifier" pattern), query by that indexed value directly (`WHERE lookup_hash = $1`), and only use `bcrypt`/constant-time comparison (or none, since SHA-256 of a high-entropy token is already unguessable) for the final check — not a linear scan.

**Regression test:** Create >200 valid refresh tokens across various users; verify logout/refresh work correctly for an "old" token outside the most-recent-200 window.

---

**C7 — IDOR on subscription transactions via `getTransaction`**
**Severity:** Critical **Confidence:** High
**Location:** `services/billing-service/src/services/billingService.js#getTransaction` (~line 488–515)

**Problem:**
```js
const consultation = tx.consultationCharge?.consultation;
if (consultation) {
  const isCustomer = consultation.customerId === auth.customerProfileId;
  const isExpert = consultation.expertId === auth.expertProfileId;
  if (!isCustomer && !isExpert) throw forbidden("Access denied");
} else if (auth.role !== "expert" && auth.role !== "customer") {
  throw forbidden("Access denied");
}
```
`Transaction` rows created for `type: "subscription"` (see `subscribe()`) have no linked `ConsultationCharge`, so `consultation` is always `null` for them. The `else if` branch is the *only* check applied in that case — and it only verifies the caller has *some* valid role, which is true for essentially every authenticated user on the platform.

**Failure scenario:** Any logged-in customer or expert calls `GET /billing/transactions/<any-subscription-transaction-id>` and receives full transaction details (amount, currency, metadata including `expertProfileId`, `planId`) for a subscription payment that isn't theirs.

**Impact:** Cross-account financial data disclosure (IDOR) — limited by UUID guessability, but a clear, unambiguous access-control gap on financial records.

**Fix:** For every transaction type, check ownership using `transaction.metadata` (already includes `expertProfileId`/`customerProfileId` at creation time) or a proper first-class foreign key, not just "is the caller *a* customer or expert."

**Regression test:** As Expert A, fetch Expert B's subscription transaction ID; expect 403, not 200.

---

### HIGH

---

**H1 — Unauthenticated subscription-expiry endpoint**
**Severity:** High **Confidence:** High
**Location:** `services/billing-service/src/routes/billing.routes.js` (~line 204)
**Problem/Failure scenario:** The route comment reads: *"Should only be called by your PM2 cron task or an internal scheduler. Protect this in production with an internal secret header or restrict to localhost."* No such protection exists — it's `asyncHandler(async (_req, res) => { ... })` with zero guards.
**Impact:** Anyone can trigger `expireSubscriptions()` at will. The business-logic guard conditions (`cancelAtPeriodEnd: true AND currentPeriodEnd <= now`) limit direct abuse, but this is an open, unauthenticated, data-mutating endpoint that the code itself documents as needing protection.
**Fix:** Gate with the same internal-secret mechanism recommended for C4, or restrict at the network/reverse-proxy layer to localhost/cron only.
**Regression test:** Call the endpoint without internal auth from an external IP; expect 403/404.

---

**H2 — OTP/password-reset endpoints send real messages regardless of account existence, with weak throttling**
**Severity:** High **Confidence:** High
**Location:** `userService.js#sendOtp`, `#forgotPassword`; `shared/auth/otp.js#assertOtpResendAllowed`
**Problem:** `sendOtp()` never checks if a user exists for the given `email`/`phone` before calling `createAndDeliverOtp`, which really dispatches an email (SendGrid) or SMS (Twilio Verify). The only throttle is a 60-second **per-identifier** cooldown (`assertOtpResendAllowed`) — there is no cap on the number of *distinct* identifiers one caller can target, and no rate limiting at all on these specific routes beyond the general, IP-based `authRateLimiter` applied at the gateway (bypassable by rotating IPs, and inapplicable if a service is ever reached directly).
**Failure scenario:** A caller iterates over a list of phone numbers, POSTing to `/auth/password/forgot` for each — real SMS (which costs money via Twilio) is sent to every number, whether or not it's a real XprtLink account.
**Impact:** Cost-based and harassment-based abuse vector against arbitrary phone numbers/emails, unauthenticated.
**Fix:** Add identifier-scoped rate limiting (e.g., N sends per phone/email per day, independent of IP), and consider requiring a CAPTCHA after repeated triggers from the same IP/device.
**Regression test:** Fire 50 distinct-identifier OTP requests from one IP within a minute; expect throttling to kick in well before 50.

---

**H3 — Admin login gets weaker rate limiting than customer login**
**Severity:** High **Confidence:** High
**Location:** `services/api-gateway/server.js`; `services/admin-service/src/routes/auth.routes.js`
**Problem:** `app.use("/api/v1/auth", authRateLimiter)` (10 req/15min) only covers user-service auth. Admin auth lives at `/api/v1/admin/auth/*` and only receives `app.use(defaultRateLimiter)` (100 req/15min).
**Impact:** The account type with the most damage potential if compromised (any admin, especially `super_admin`) has 10x weaker brute-force protection than ordinary customer accounts.
**Fix:** `app.use("/api/v1/admin/auth", authRateLimiter)` in the gateway, or an equivalent explicit route-level limiter in admin-service.
**Regression test:** Confirm the admin login route responds with 429 after the same request count that trips `authRateLimiter` for user-service login.

---

**H4 — OTP verification debug log leaks sensitive data in production**
**Severity:** High **Confidence:** High
**Location:** `shared/auth/otp.js#verifyOtpCode` (~line 82)
```js
if (challenge.codeHash === "TWILIO_VERIFY" && challenge.phone) {
  console.log("[DEBUG] Verify Twilio:", {
    hardcodeEnabled: process.env.OTP_ENABLE_HARDCODE,
    nodeEnv: process.env.NODE_ENV,
    hardcodeCode: process.env.OTP_HARDCODE_CODE,
    inputCode: code
  });
  ...
```
**Problem:** This block is not gated by `NODE_ENV` at all — it runs on every phone-based OTP verification, in every environment, including production.
**Impact:** Verification codes (and the dev hardcode-bypass configuration) get written to production stdout/log aggregation on every attempt — a straightforward sensitive-data-in-logs issue, and unnecessary since Twilio Verify itself already tracks/validates the code server-side.
**Fix:** Delete this debug block, or wrap it in `if (process.env.NODE_ENV !== 'production')` and never log the raw `code`.
**Regression test:** Grep production log output after an OTP verification call; assert no OTP code appears.

---

**H5 — No production error logging; unhandled Prisma errors leak internals**
**Severity:** High **Confidence:** High
**Location:** `shared/middleware/errorHandler.js`
```js
if (process.env.NODE_ENV !== "production" && statusCode >= 500) {
  try { console.error(err); } catch { console.error(String(err)); }
}
```
**Problem:** Two compounding issues:
1. Server-side logging of 500-level errors is explicitly **disabled** in production — the one environment where you most need it.
2. There is zero special handling anywhere in the codebase for Prisma's `PrismaClientKnownRequestError` (confirmed via `grep -rn "P2002\|PrismaClientKnownRequestError"` returning no results). Any unique-constraint race (e.g., the registration TOCTOU in H7) throws a raw Prisma error, which falls through to `statusCode = err.statusCode || err.status || 500` (Prisma errors have neither), and `message = err.message` — which for Prisma is often something like `"Unique constraint failed on the fields: (email)"`. That message is sent directly to the client as JSON.

**Impact:** Production incidents are invisible server-side (no logs to debug from) at the same time the client receives internal database error text instead of a clean 409.
**Fix:** Always log 5xx server-side regardless of environment (route it to your monitoring pipeline). Add explicit mapping: `PrismaClientKnownRequestError` with code `P2002` → 409 Conflict with a generic message; `P2025` (record not found) → 404; etc.
**Regression test:** Force a concurrent duplicate-email registration; assert the client receives a clean 409 with a generic message, and the server logs the underlying error.

---

**H6 — Unscoped `updateMany` in email/phone verification**
**Severity:** High **Confidence:** Medium
**Location:** `userService.js#verifyOtp`, generic verify branch (~line 395–406)
```js
...(purpose === "verify_email" && email
  ? [db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } })]
  : []),
```
**Problem:** Scoped only by `email`/`phone`, not by `challenge.userId`. Because uniqueness is enforced only via the partial index `WHERE deleted_at IS NULL`, a soft-deleted row can share an email/phone with an active row.
**Impact:** A verification action intended for one user's OTP challenge can also stamp `emailVerifiedAt`/`phoneVerifiedAt` on an unrelated (deleted) row sharing the same identifier. Low direct harm today, but it's exactly the "query can accidentally affect multiple rows" pattern the business explicitly wants flagged, and becomes more dangerous if `emailVerifiedAt ` is ever used as a security gate elsewhere.
**Fix:** `where: { id: challenge.userId }` instead of `{ email }`/`{ phone }`.
**Regression test:** Create a soft-deleted user and an active user sharing an email; verify email OTP for the active user; assert only the active row's `emailVerifiedAt` changes.

---

**H7 — Registration TOCTOU / pending-user cross-contamination**
**Severity:** High **Confidence:** Medium
**Location:** `userService.js#register` (~line 128–180)
**Problem:** `assertIdentifierAvailable` (a read) and the later `pending`-row lookup + `create`/`update` (a write) are not wrapped in a single transaction, and the `pending` lookup matches on `OR:[{email},{phone}]` — meaning a row that only matches on `email` gets its `phone` overwritten too (and vice versa) by whatever the new request supplied.
**Failure scenario:** Two concurrent registration attempts with the same email can both pass `assertIdentifierAvailable` (since `pending_verification` rows are excluded from that check) and then race on `create`; the DB's partial unique index will catch the true duplicate-create case (surfacing as the ugly 500 from H5), but the update path for an existing `pending` row can silently overwrite a different phone/email pairing than the one that originally started that pending signup — this is the exact mechanism enabling the C1 email-squatting flow.
**Fix:** Wrap the whole read-then-write in a `$transaction`; require the `pending` match to agree on *both* identifiers (or introduce a signup-session token instead of matching on mutable identifiers).
**Regression test:** Start a pending signup with email A + phone X; send a second registration request with email A + phone Y; assert this is rejected or handled deliberately, not silently merged.

---

**H8 — CORS fully open outside literal `NODE_ENV=production`**
**Severity:** High **Confidence:** Medium
**Location:** `shared/config/serviceTemplate.js#getCorsOriginValidator`
```js
if (!origin || origin === "null" || process.env.NODE_ENV !== "production") {
  return callback(null, true);
}
```
**Problem:** The "allow requests with no Origin" exception (correct and standard for non-browser clients) is bundled with a blanket exception for *any* environment where `NODE_ENV` isn't exactly the string `"production"`.
**Impact:** A staging/QA/preview deployment that forgets (or fails, e.g. via a bad `.env`) to set `NODE_ENV=production` silently allows any website to make credentialed cross-origin requests (`credentials: true` is set unconditionally in `createApp()`).
**Fix:** Separate the "is this a browser Origin at all" check from environment-based bypass; use an explicit `CORS_ALLOW_ALL=true` dev-only flag instead of overloading `NODE_ENV`.
**Regression test:** Set `NODE_ENV=staging`, send a cross-origin request with an arbitrary `Origin` header; assert it's rejected unless in the allowlist.

---

**H9 — `getMediaAsset` owner-only check likely blocks legitimate cross-user access**
**Severity:** High **Confidence:** Medium
**Location:** `services/media-service/src/services/mediaService.js#getMediaAsset`
**Problem:** `if (asset.ownerUserId !== auth.userId) throw forbidden(...)`. Media assets exist for `avatar`, `quote_attachment`, `chat_attachment`, and `verification_doc` purposes — several of which are, by design, meant to be seen by someone other than the uploader (the other party in a conversation/quote, or any customer browsing an expert's public avatar).
**Impact:** If any client flow calls `GET /media/:id` to resolve a chat/quote attachment or expert avatar for a *non-owning* participant, it will incorrectly 403. (Not confirmed to be exploited *as* a vulnerability — flagged as a probable functional/business-logic bug worth verifying against the actual attachment-rendering flow used by messaging/quotes/expert-profile responses.)
**Fix:** If this endpoint is on the read path for shared assets, extend authorization to "owner OR a participant in the conversation/quote that references this media OR the asset is a public-facing avatar," rather than owner-only.
**Regression test:** As the customer in a conversation, fetch a media asset uploaded by the expert counterpart via a message attachment; confirm it's retrievable.

---

### MEDIUM (abridged — see table above for full list; expanding the two most concrete)

**M1 — Zero `CHECK` constraints in the database**
**Severity:** Medium **Confidence:** High
**Location:** All of `shared/prisma/migrations/*/migration.sql` (grep confirms 0 matches for `CHECK`)
**Problem:** Every data invariant — `Review.rating` (1–5), every `*Cents` amount (should be ≥ 0), `PaymentMethod.expMonth` (1–12)/`expYear`, `ExpertProfile.experienceYears` (≥ 0), `ExpertProfile.ratingAvg` (0–5) — is enforced only in the Zod layer (`shared/contracts/*.schema.js`).
**Impact:** Any code path that touches the DB directly (a script under `scripts/`, a future internal tool, a Prisma raw query, a bug that bypasses the schema validator) can write invalid data with nothing to stop it at the database boundary — directly the "prefer database-enforced correctness" principle this audit was asked to check for.
**Fix (example):**
```sql
ALTER TABLE reviews ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE transactions ADD CONSTRAINT transactions_amount_nonneg CHECK (amount_cents >= 0);
ALTER TABLE expert_profiles ADD CONSTRAINT expert_profiles_rate_nonneg CHECK (consultation_rate_cents >= 0);
ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_exp_month_range CHECK (exp_month BETWEEN 1 AND 12);
```
**Regression test:** Attempt to insert a `Review` with `rating = 999` via a raw SQL client; expect the insert to fail at the DB level, not just at the API layer.

---

**M2 — Silent role downgrade on token refresh**
Already detailed in the findings table above (`shared/auth/tokens.js#refresh`). Fix: persist originating role on `RefreshToken`, or make `role` a required parameter on `/auth/refresh`.

*(M3–M10 detailed sufficiently in the findings table; repeated in full prose on request.)*

---

## Basic Backend Sanity Check

Walking through the exact "break it with simple inputs" checklist:

| Input | Result | Verdict |
|---|---|---|
| Nonexistent user ID (`GET /consultations/:id` with random UUID) | `loadConsultation` → `notFound()` → 404 | ✅ Correct |
| Nonexistent resource ID generally | Consistently uses `findUnique`/`findFirst` + explicit `notFound()` throw across `engagementService.js`, `billingService.js`, `mediaService.js`, `notificationService.js` | ✅ Correct, this pattern is applied consistently |
| Wrong user's resource ID (e.g., another customer's quote/consultation/payment method) | `assertQuoteParticipant`/`assertConsultationParticipant`/ownership `findFirst` scoped to `customerProfileId` — correctly blocked | ✅ Correct **except** `getTransaction` for subscription-type transactions (C7) and `getMediaAsset`'s over-restriction (H9) |
| Duplicate emails at signup | Blocked by `assertIdentifierAvailable` + DB partial unique index — **but** the race window (H7) and the resulting raw-500-on-collision (H5) are real | ⚠️ Partially correct |
| Duplicate/replayed requests (e.g., double-submit consultation request, double `saveExpert`) | `saveExpert`/`recordRecentlyViewed` use `upsert` (idempotent, good). `createConsultation`/`createQuote` have **no** idempotency guard | ⚠️ Inconsistent — some endpoints idempotent, others not |
| Empty strings / `null` / missing properties / wrong types | Zod schemas (`shared/contracts/*`) are applied via `.parse()` at the top of nearly every route handler — reasonably thorough | ✅ Mostly correct |
| Invalid UUIDs | Not all path params are validated as UUID shape before hitting Prisma (e.g. `req.params.id` passed straight into `findUnique({ where: { id } })` in many controllers) — Prisma will throw a generic error on a malformed UUID, which (per H5) becomes an unhandled 500 instead of a clean 400 | ⚠️ Bug — malformed UUID → 500 instead of 400 |
| Invalid enum values | Enforced by Zod `.enum()` in contracts for anything client-supplied | ✅ Correct |
| Negative numbers / zero for money fields | **Not** enforced by Zod min-bounds everywhere, and definitely not by the DB (M1) — e.g. `body.budget`/`amountToCents` in quotes has no confirmed lower bound reviewed here | ⚠️ Needs explicit re-check per contract |
| Extremely large values | `express.json({limit:'100mb'})` globally (M3) — no per-field numeric upper bounds seen for things like `durationSeconds` passed to the internal capture endpoint (C4) | ⚠️ Bug (ties to C4) |
| Expired tokens | `verifyAccessToken` / JWT `exp` handled correctly, mapped to 401 in `authenticate()` | ✅ Correct |
| Already-used tokens (OTP, refresh) | OTP: `consumedAt` checked correctly in `findValidOtpChallenge`. Refresh: revoked correctly **when found** — but see C6, tokens outside the "most recent 200" are never found at all | ⚠️ Correct in principle, broken at scale |
| Invalid tokens | Malformed JWTs → caught, mapped to 401 | ✅ Correct |
| Deleted users | `deletedAt`/`status` checked at login; **not** rechecked on refresh (C2) | ❌ Bug (C2) |
| Disabled/suspended users | Checked at login only; not on refresh or per-request (C2) | ❌ Bug (C2) |
| Concurrent requests (e.g., two simultaneous `subscribe()` calls) | `subscribe()` wraps its guard-and-create in `$transaction` — good practice, though Prisma's default transaction isolation (read committed) means the "check existing active subscription" read isn't itself locked; a genuine two-request race could still both pass the `existingActive` check before either commits. Not confirmed exploitable without a live DB but worth a `SELECT ... FOR UPDATE` or a partial unique index equivalent (one already exists: `expert_subscriptions_one_active_idx`) — that index actually *does* provide a backstop here | ✅ Backstopped by the partial unique index, good defense-in-depth already present |
| Database constraint violations (surfaced to the client) | No P2002/Prisma error handling anywhere (H5) | ❌ Bug |
| Zero rows affected (e.g., an `update`/`updateMany` matching nothing) | Most single-record mutations correctly go through a `findFirst`-then-`notFound()` pattern before mutating. The exceptions are the `updateMany` calls in H6 and the Stripe webhook handlers (`db.transaction.updateMany({ where: { stripePaymentIntentId: pi.id }, ... })`), which silently no-op on zero matches with no logging of that case | ⚠️ Silent no-op on zero-match updateMany calls (webhook handler, H6) |
| Multiple rows unexpectedly affected | See H6 (`updateMany` on `email`/`phone` not scoped to a single user) | ❌ Bug (H6) |

---

## 1. Top 10 fixes to make immediately
1. Fix C4 — validate `SERVICE_SECRET` (or equivalent) on every internal-only route; it's already half-built and unused.
2. Fix C2 — check `user.status === 'active'` inside `refresh()` before issuing new tokens.
3. Fix C3 — revoke all refresh tokens/sessions on password reset and password change.
4. Fix C1 — only mark the OTP channel actually verified; require both for full verification.
5. Fix C5 — add `ExpertProfile.stripeAccountId`, persist it after KYC, and stop using the `acct_stub_` fallback.
6. Fix C7 — close the `getTransaction` IDOR for subscription-type transactions.
7. Fix C6 — replace the 200-row bcrypt-scan refresh-token lookup with an indexed lookup.
8. Fix H4/H5 — delete the OTP debug log; always log 5xx server-side; add Prisma error mapping.
9. Fix H1 — lock down `/billing/subscriptions/expire`.
10. Fix H3 — apply `authRateLimiter` to admin login.

## 2. Tests you are missing
- Suspended/deleted user attempting `/auth/refresh` → must be rejected (currently isn't).
- Password reset/change followed by reuse of the pre-reset refresh token → must fail (currently succeeds).
- External caller hitting `/billing/consultations/:id/capture` with a fabricated `x-internal-service` header → must be rejected (currently succeeds).
- Registration with `otpChannel: "phone"` → assert `emailVerifiedAt` stays null until a separate email verification occurs.
- `getTransaction` on a subscription-type transaction owned by another expert → must 403.
- Concurrent duplicate-email registration → must return a clean 409, not a raw Prisma 500.
- Malformed (non-UUID) path param on any `:id` route → must return 400, not 500.
- Logout/refresh correctness once >200 valid refresh tokens exist platform-wide.
- Zego webhook: reused `(timestamp, nonce, signature)` triple with a different `event`/`room_id` → should be rejected if a nonce store is added.
- Admin login brute-force attempt count vs. the same threshold enforced for user-service login.

## 3. Database constraints to add
- `CHECK (rating BETWEEN 1 AND 5)` on `reviews`.
- `CHECK (amount_cents >= 0)` on `transactions`, `expert_payouts`, `expert_earnings_ledger` (gross/commission/net), `consultation_charges` (commission/expert share).
- `CHECK (consultation_rate_cents >= 0)` on `expert_profiles`; `CHECK (rate_per_minute_cents >= 0)` on `consultations`.
- `CHECK (exp_month BETWEEN 1 AND 12)` on `payment_methods`.
- `CHECK (experience_years >= 0)` on `expert_profiles`.
- `CHECK (rating_avg >= 0 AND rating_avg <= 5)` on `expert_profiles`.
- Add the missing `stripe_account_id` column on `expert_profiles` (C5) — an application bug, but the column itself belongs in the schema.

## 4. API endpoints that need redesign
- `/billing/consultations/:id/capture` and `/consultations/:id/charge` — replace header-presence auth with real internal authentication.
- `/billing/subscriptions/expire` — same.
- `/billing/transactions/:id` — ownership check needs to cover all transaction types, not just consultation-linked ones.
- `/auth/refresh` — needs a status check and a non-linear-scan lookup strategy; consider persisting `role` on the refresh token row.
- `/media/:id` — needs relationship-aware authorization instead of owner-only, if it's meant to serve shared attachments/avatars.

## 5. Security issues
- C1 (email squatting), C2 (bans not enforced), C3 (sessions survive password reset), C4 (internal auth bypass), C7 (transaction IDOR), H2 (OTP/SMS bombing), H3 (weak admin brute-force protection), H4 (OTP leaked to logs), H8 (CORS wide open outside strict `NODE_ENV=production`), M6 (unauthenticated enumeration oracle), M7 (timing-based enumeration), M8 (admin logout doesn't revoke).

## 6. Performance issues
- C6's bcrypt-loop refresh-token lookup (also a correctness bug, but adds real latency: up to 200 sequential bcrypt.compare calls per refresh/logout).
- Offset-based pagination throughout with no cursor alternative for high-volume tables.
- No `connection_limit` tuning across ~10 independently-pooling Prisma clients against one Postgres instance.
- `express.json({limit:'100mb'})` globally applied — unnecessary memory pressure risk on every route, not just upload endpoints.

## 7. Basic mistakes that should never reach production
- A hardcoded, publicly-visible string used as an "internal service" credential (C4).
- An admin panel endpoint (`/admins/:id/reset-password` etc.) is correctly protected — good — but a payments endpoint one file over is not (C4) — inconsistent security posture within the same codebase.
- A debug `console.log` of user-submitted OTP codes left in the auth path (H4).
- Production error logging disabled by an inverted `NODE_ENV` check (H5).
- A comment in the code that literally says "this needs protection" directly above unprotected code (H1).
- An env var (`SERVICE_SECRET`) that's configured, documented, and checked-for-presence in tooling, but never actually used anywhere (C4/H1).
- A `stripeAccountId` field referenced in code that was never added to the schema (C5).

## 8. Prioritized remediation plan
**Week 1 (stop the bleeding):**
- C4 (internal auth bypass), C2 (ban enforcement), C3 (session revocation on password reset), H1 (subscription-expire endpoint), H4 (OTP log leak), H5 (prod error logging + Prisma error mapping).

**Week 2:**
- C1 (email verification), C7 (transaction IDOR), C5 (Stripe account persistence), H3 (admin rate limiting), H6 (scoped updateMany), H7 (registration TOCTOU).

**Week 3–4:**
- C6 (refresh-token lookup redesign), H2 (OTP abuse throttling), H8 (CORS), H9 (media ownership model — needs product/design input on intended sharing semantics), M1 (DB CHECK constraints), M9 (consultation idempotency + expert eligibility checks).

**Ongoing / hardening backlog:**
- M2–M10 and all Low findings; add automated tests for every item in Section 2 above as each fix lands, so these don't regress.

---

*Audit performed by static code review against the full repository contents (schema, migrations, all 10 services, shared libraries, middleware, and route definitions) as of the current `main` branch at time of review. No live database or running instance was available for dynamic/black-box testing — findings involving concurrency (e.g., true two-request races) are based on code inspection and Prisma/Postgres semantics, not observed runtime behavior, and are marked with appropriate confidence levels.*