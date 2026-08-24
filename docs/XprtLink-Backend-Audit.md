# XprtLink Backend Audit — Consolidated (Source of Truth)

**Audit date:** August 2026  
**Repo:** `xpertlink-backend` (10 Express services + `shared` workspace, Prisma/Postgres, Stripe, ZegoCloud, Firebase, Twilio)  
**Previous audit:** Reviewed and merged. Items marked ✅ RESOLVED were confirmed fixed in the current codebase.

---

## Executive Summary

**Overall backend quality: C+**

The codebase shows competent architectural decisions (JWT + refresh rotation with SHA-256 indexed lookup, proper ownership scoping, Zod validation, Stripe signature verification, admin session tracking) and has been through hardening passes (partial unique indexes, FK RESTRICT on financial tables, idempotency indexes). However, several **critical correctness bugs** and **data integrity gaps** remain that would cause failures in production.

| Severity | Count |
|----------|-------|
| **Critical** | 6 |
| **High** | 11 |
| **Medium** | 14 |
| **Low** | 10 |
| **Total** | **41** |

### Top 5 Most Dangerous Problems
1. **`User.email` and `User.phone` have NO UNIQUE constraint** — multiple active users can share the same email/phone, breaking login, OTP, and password reset
2. **`submitCustomConnectKyc` never persists `stripeAccountId`** — expert bank account attachment is permanently broken
3. **Internal service guard accepts any header value** — unauthenticated attacker can trigger Stripe captures
4. **Missing `conflict` import in engagement-service** — duplicate review crashes with `ReferenceError`
5. **TOCTOU race conditions on all state transitions** — concurrent requests can corrupt quote/consultation state

### Top 5 Most Embarrassing/Basic Bugs
1. Calling `conflict()` without importing it → `ReferenceError` crash in production
2. KYC creates Stripe account → returns to client → never saves ID → next endpoint always fails
3. `createQuote` catches Zod errors and silently passes raw unvalidated body
4. No unique constraint on login identifier → `findFirst` returns arbitrary user
5. `POST /auth/refresh` has zero input validation

---

## Previously Fixed Items (from prior audit)

These items from the earlier audit have been **confirmed fixed** in the current codebase:

| Old ID | Issue | Status | How Fixed |
|--------|-------|--------|-----------|
| C1 | Email squatting (both channels stamped regardless of OTP channel) | ✅ RESOLVED | Now only stamps verified channel (code comment `C1`) |
| C2 | Suspended users retain access via refresh | ✅ RESOLVED | `lookupRefreshToken` now checks `user.status !== "active"` and revokes (code comment `C2`) |
| C3 | Password reset/change doesn't revoke sessions | ✅ RESOLVED | `revokeAllUserSessions(userId)` called in both flows (code comment `C3`) |
| C6 | Refresh token bcrypt-only linear scan | ✅ RESOLVED | SHA-256 HMAC indexed lookup is primary path; bcrypt is legacy fallback only |
| H3 | Admin login weaker rate limiting | ✅ RESOLVED | `authRateLimiter` now applied to `/api/v1/admin/auth` |
| H4 | OTP debug console.log in production | ✅ RESOLVED | Debug log removed |
| H5 | No prod error logging + no Prisma error mapping | ✅ RESOLVED | Always logs 5xx; maps P2002→409, P2025→404, P2003→400 |
| H8 | CORS open outside `NODE_ENV=production` | ✅ RESOLVED | Now uses explicit `CORS_ALLOW_ALL` flag |
| M3 | 100MB global body limit | ✅ RESOLVED | Now 1MB default |
| M7 | Timing-based login enumeration | ✅ RESOLVED | Dummy bcrypt compare added (code comment `M7`) |
| M8 | Admin logout doesn't revoke (stateless JWT) | ✅ RESOLVED | `AdminSession` table with SHA-256 token hash, checked on every request |
| H1 | `/subscriptions/expire` fully unauthenticated | ⚠️ PARTIALLY | Now has `internalServiceGuard` but guard is weak (see finding #4 below) |

---

## Current Findings

### CRITICAL

---

#### 1. User.email and User.phone have no UNIQUE constraint

**Severity:** Critical | **Confidence:** High  
**Location:** `shared/prisma/schema.prisma` — `model User`

**Problem:** `email` and `phone` are nullable with no unique constraint. Only `firebaseUid` is `@unique`. The application-level check (`assertIdentifierAvailable`) uses `findFirst` which is inherently racy.

**Failure scenario:** Two concurrent registration requests with the same email both pass `assertIdentifierAvailable` (both read "available"), both create users. Now login with that email returns an arbitrary row. Password reset targets the wrong account.

**Impact:** Authentication system fundamentally broken for any email/phone with duplicates. Identity confusion, account takeover.

**Fix:**
```sql
CREATE UNIQUE INDEX idx_users_email_active ON users (email)
  WHERE email IS NOT NULL AND status NOT IN ('deleted');
CREATE UNIQUE INDEX idx_users_phone_active ON users (phone)
  WHERE phone IS NOT NULL AND status NOT IN ('deleted');
```

**Regression test:** Two concurrent registrations with same email → one succeeds, one gets 409.

---

#### 2. `submitCustomConnectKyc` never persists `stripeAccountId`

**Severity:** Critical | **Confidence:** High  
**Location:** `billing-service/billingService.js` — `submitCustomConnectKyc`; `schema.prisma` — `ExpertProfile`

**Problem:** `createCustomConnectAccount` returns a real Stripe account object with `account.id`. The function returns it to the client but **never saves it to the database**. Furthermore, `ExpertProfile` in the schema has **no `stripeAccountId` column at all**.

**Failure scenario:** Expert completes KYC → calls `attachBankAccount` → code reads `expert.stripeAccountId` → always `undefined` → throws `KYC_REQUIRED`. Expert payout flow is permanently dead.

**Impact:** Entire expert payout feature is non-functional.

**Fix:**
1. Add to schema: `stripeAccountId String? @map("stripe_account_id") @db.VarChar(128)`
2. After `createCustomConnectAccount`, persist: `await db.expertProfile.update({ where: { id: auth.expertProfileId }, data: { stripeAccountId: account.id } })`
3. Remove `acct_stub_` fallback — fail loudly if missing.

**Regression test:** Run KYC → assert `expertProfile.stripeAccountId` is populated → run bank-account attach → assert real Stripe ID is used.

---

#### 3. Missing `conflict` import crashes duplicate review submission

**Severity:** Critical | **Confidence:** High  
**Location:** `engagement-service/engagementService.js` — `submitReview`

**Problem:**
```js
import { badRequest, forbidden, notFound } from "@xprtlink/shared/utils/errors.js";
// ... later:
throw conflict("Review already submitted", "REVIEW_EXISTS"); // ReferenceError!
```

**Failure scenario:** Customer submits a review for a consultation they already reviewed → unhandled `ReferenceError: conflict is not defined` → 500 crash.

**Impact:** Application crash on a common user action. Ugly 500 error to mobile client.

**Fix:** Add `conflict` to the import statement.

**Regression test:** Submit a review, submit again → expect clean 409, not 500.

---

#### 4. Internal service guard accepts any header value

**Severity:** Critical | **Confidence:** High  
**Location:** `billing-service/routes/billing.routes.js` — `internalServiceGuard`

**Problem:**
```js
if (!header) return 403;
if (secret && process.env.NODE_ENV === "production" && header !== secret) return 403;
```
In non-production (staging, dev): any non-empty `x-internal-service` header passes. In production: validates against `SERVICE_SECRET`, but the calling code (`internalFetch.js`, `zegoCallbackService.js`) sends hardcoded strings visible in source.

**Failure scenario:** In staging: anyone sends `x-internal-service: x` and calls `POST /billing/consultations/:id/capture` with arbitrary `durationSeconds`. In production: attacker uses the hardcoded header value from the public source code.

**Impact:** Unauthenticated financial manipulation — force-capturing Stripe holds with attacker-chosen amounts.

**Fix:** Always validate against `SERVICE_SECRET` regardless of environment. Use HMAC-signed requests or mutual TLS for service-to-service calls.

**Regression test:** Call capture endpoint with bogus header → expect 403 in ALL environments.

---

#### 5. Quote creation silently swallows Zod validation

**Severity:** Critical | **Confidence:** High  
**Location:** `engagement-service/routes/quotes.routes.js` — `POST /`

**Problem:**
```js
try {
  body = createQuoteRequestSchema.parse(req.body);
} catch (e) {
  body = req.body; // Silent fallback to unvalidated input!
}
```

**Failure scenario:** Client sends malformed body (wrong types, missing fields, XSS in strings). Validation error is caught and ignored. Raw unvalidated body passes to service layer.

**Impact:** All input validation bypassed. Garbage data in DB, potential injection.

**Fix:** Remove the try/catch. Let Zod throw. `asyncHandler` already catches it and returns 400.

**Regression test:** Send invalid quote body → assert 400 validation error, not 201 success.

---

#### 6. `getTransaction` IDOR for subscription-type transactions

**Severity:** Critical | **Confidence:** High  
**Location:** `billing-service/billingService.js` — `getTransaction`

**Problem:**
```js
const consultation = tx.consultationCharge?.consultation;
if (consultation) {
  // Ownership check for consultation-linked transactions ✅
} else if (auth.role !== "expert" && auth.role !== "customer") {
  throw forbidden("Access denied");
}
```
For `type: "subscription"` transactions, `consultationCharge` is null. The else-if only checks "is the caller a customer or expert" — which is true for ALL authenticated users. No ownership check.

**Failure scenario:** Expert A fetches `GET /billing/transactions/<Expert-B-subscription-tx-id>` → gets full financial details (amount, metadata including `expertProfileId`, `planId`).

**Impact:** Cross-account financial data disclosure.

**Fix:** Check `tx.metadata.expertProfileId === auth.expertProfileId || tx.metadata.customerProfileId === auth.customerProfileId` for all transaction types.

**Regression test:** As Expert A, fetch Expert B's subscription transaction → expect 403.

---

### HIGH

---

#### 7. TOCTOU race conditions on quote/consultation state transitions

**Severity:** High | **Confidence:** High  
**Location:** `engagement-service/engagementService.js` — all state transitions

**Problem:** Status is checked via `loadQuote()`/`loadConsultation()` OUTSIDE the transaction, then updated INSIDE. Between read and write, concurrent requests can both read the same "valid" status.

**Failure scenario:** Two concurrent `acceptQuote` calls both read status="quoted" → both transition to "accepted" → two status events logged, inconsistent timestamps.

**Fix:** Move `loadQuote` + status check inside the transaction with `SELECT FOR UPDATE`, or add `WHERE status = 'expected_status'` in the update clause and check `affected_rows`.

**Regression test:** Fire 2 concurrent accept calls → assert only one returns success.

---

#### 8. Consultation state changes have no transactions

**Severity:** High | **Confidence:** High  
**Location:** `engagement-service/engagementService.js` — `acceptConsultation`, `declineConsultation`, `endConsultation`

**Problem:** These are bare `update()` calls with no wrapping transaction. Concurrent calls can produce inconsistent state.

**Failure scenario:** Two `endConsultation` calls write different `durationSeconds` values. Last write wins.

**Fix:** Wrap in `$transaction` and use `WHERE status IN (active_statuses)` in the update. Check affected rows.

---

#### 9. Rating calculation is not atomic

**Severity:** High | **Confidence:** High  
**Location:** `engagement-service/engagementService.js` — `submitReview`

**Problem:** Reads `ratingAvg` + `ratingCount`, computes new average in JS, writes back. Two concurrent reviews read the same count, one review's rating is lost.

**Fix:** Use raw SQL: `UPDATE expert_profiles SET rating_count = rating_count + 1, rating_avg = ((rating_avg * rating_count) + $1) / (rating_count + 1) WHERE id = $2`

---

#### 10. `endConsultation` does not trigger billing capture

**Severity:** High | **Confidence:** High  
**Location:** `engagement-service/engagementService.js` — `endConsultation`

**Problem:** Only the ZegoCloud `room_close` webhook triggers billing-service capture. Manual end via the API does not. If the webhook never fires, customer is never charged.

**Fix:** Add the same internal HTTP call to billing-service capture from `endConsultation`.

---

#### 11. No Zod validation on `/me/onboarding`

**Severity:** High | **Confidence:** High  
**Location:** `expert-service/expertService.js` — `saveOnboarding`; route `POST /me/onboarding`

**Problem:** Raw `req.body` passed directly. Client can send huge payloads, wrong types, XSS in headline/bio.

**Fix:** Create and apply `expertOnboardingSchema`.

---

#### 12. No Zod validation on `/me/settings`

**Severity:** High | **Confidence:** High  
**Location:** `expert-service/expertService.js` — `updateSettings`; route `PATCH /me/settings`

**Problem:** Arbitrary JSON written to `preferences` column. No size limit. DoS vector.

**Fix:** Create a bounded schema for settings preferences with known keys and max size.

---

#### 13. `estimatedCents` client-controlled in pre-auth hold

**Severity:** High | **Confidence:** High  
**Location:** `billing-service/billingService.js` — `holdConsultationFunds`

**Problem:** `body.estimatedCents` comes from client. Malicious client passes `estimatedCents: 100` ($1). Real consultation costs $50 → Stripe capture fails.

**Fix:** Enforce server-calculated minimum: `Math.max(body.estimatedCents ?? 0, 30 * consultation.ratePerMinuteCents, 3000)` or ignore client value entirely.

---

#### 14. `POST /auth/refresh` has no input validation

**Severity:** High | **Confidence:** High  
**Location:** `user-service/auth.routes.js`

**Problem:** No Zod schema. `role` is unvalidated — could be `"admin"`. `refreshToken` is not checked for presence at the route level.

**Fix:** Add `z.object({ refreshToken: z.string().min(1), role: sessionRoleSchema.optional() })`.

---

#### 15. Media service blocks legitimate cross-user access

**Severity:** High | **Confidence:** Medium  
**Location:** `media-service/mediaService.js` — `getMediaAsset`

**Problem:** `if (asset.ownerUserId !== auth.userId) throw forbidden()`. Chat attachments, quote attachments, and expert avatars are meant to be viewed by the other party, but this blocks them.

**Fix:** Add relationship-based authorization: owner OR participant in conversation/quote referencing this media OR asset is a public avatar.

---

#### 16. Registration TOCTOU / pending-user cross-contamination

**Severity:** High | **Confidence:** Medium  
**Location:** `user-service/userService.js` — `register`

**Problem:** The pending-row lookup matches `OR:[{email},{phone}]` and overwrites **both** fields. If a pending user exists with matching email but different phone, the new request's phone overwrites it.

**Fix:** Wrap in `$transaction`; require the pending match to agree on both identifiers.

---

#### 17. `submitOnboarding` and `submitVerificationDocuments` lack transactions

**Severity:** High | **Confidence:** High  
**Location:** `expert-service/expertService.js`

**Problem:** Multiple DB operations (update profile + upsert verification; create documents in loop + update status) are not transactional. Partial failure leaves inconsistent state.

**Fix:** Wrap both in `db.$transaction()`.

---

### MEDIUM

---

#### 18. `Review.rating` has no CHECK constraint

No DB enforcement of `1 <= rating <= 5`. Direct DB writes can corrupt averages.

#### 19. No CHECK constraints on monetary columns

`amount_cents`, `commission_cents`, `expert_share_cents`, `consultation_rate_cents`, `gross_cents`, `net_cents` — all lack `>= 0` constraints.

#### 20. No UUID validation on route `:id` params

Malformed UUIDs cause Prisma errors → ugly 500 instead of clean 400.

#### 21. Silent role downgrade on refresh

If client omits `role` on refresh and user has both profiles, role defaults to `customer` without warning. Original session role is lost.

**Fix:** Persist originating role on `RefreshToken` row or make `role` mandatory.

#### 22. WebSocket auth doesn't check revoked sessions

Revoked JWT remains valid for WebSocket until natural expiry.

#### 23. Webhook event ID deduplication missing

Stripe retries produce duplicate processing. Currently idempotent for status updates but will fire duplicate side-effects when notifications are added.

#### 24. Payment method not detached from Stripe on delete

Orphaned PM remains in Stripe customer record.

#### 25. Admin category CRUD lacks Zod validation

Can create categories with empty slug, huge names, invalid types.

#### 26. Admin SSE `/events` has no permission check

Any subadmin (even with `all: none`) can subscribe to SSE events.

#### 27. Quote creation silently routes to random expert on invalid expertId

If `body.expertId` not found, falls back to any expert instead of returning 404.

#### 28. ZegoCloud webhook signature doesn't cover event body

Only signs `{secret, timestamp, nonce}`. Replaying a captured triple with different `event`/`room_id` passes verification.

#### 29. Legacy bcrypt refresh token fallback (DoS potential)

Loads up to 200 tokens and loops with bcrypt (~100ms each). Remove once legacy tokens expire.

#### 30. Logout silently succeeds without refreshToken

Client thinks logged out, but session remains valid.

#### 31. `Consultation.durationSeconds` has no CHECK >= 0

Negative duration → negative billing.

---

### LOW

---

#### 32. `forgotPassword` fake response has hardcoded `expiresInSeconds: 600`

Potential enumeration if real OTP config differs.

#### 33. No index on `User.email` / `User.phone`

Login queries scan full table.

#### 34. No duplicate active consultation prevention

Customer can spam `createConsultation` creating many "requested" records for same expert.

#### 35. Public expert reviews endpoint returns empty array instead of 404

`GET /:id/reviews` for non-existent expert returns empty results, not 404.

#### 36. Incomplete admin audit log coverage

Category changes, review moderation, subscription changes not audited.

#### 37. Quote expiration mechanism missing

`expired` status exists in enum but no cron/job sets it.

#### 38. `addPaymentMethod` trusts client for `brand`/`last4`

Should fetch from Stripe after attachment.

#### 39. `MediaAsset.sizeBytes` has no CHECK > 0

#### 40. Video token issued while consultation still "requested"

Should restrict to `["accepted", "in_progress", "ringing"]`.

#### 41. `ExpertVerification` allows multiple pending records per expert

No unique constraint on `(expertProfileId)` for active verifications.

---

## Database Constraints to Add

```sql
-- Unique identity (CRITICAL)
CREATE UNIQUE INDEX idx_users_email_active ON users (email)
  WHERE email IS NOT NULL AND status NOT IN ('deleted');
CREATE UNIQUE INDEX idx_users_phone_active ON users (phone)
  WHERE phone IS NOT NULL AND status NOT IN ('deleted');

-- Missing column (CRITICAL)
ALTER TABLE expert_profiles ADD COLUMN stripe_account_id VARCHAR(128);

-- Rating bounds
ALTER TABLE reviews ADD CONSTRAINT chk_rating CHECK (rating BETWEEN 1 AND 5);

-- Non-negative monetary
ALTER TABLE transactions ADD CONSTRAINT chk_amount_positive CHECK (amount_cents >= 0);
ALTER TABLE consultation_charges ADD CONSTRAINT chk_commission_positive
  CHECK (commission_cents >= 0 AND expert_share_cents >= 0);
ALTER TABLE expert_earnings_ledger ADD CONSTRAINT chk_earnings_positive
  CHECK (gross_cents >= 0 AND commission_cents >= 0 AND net_cents >= 0);
ALTER TABLE expert_profiles ADD CONSTRAINT chk_rate_positive CHECK (consultation_rate_cents >= 0);
ALTER TABLE consultations ADD CONSTRAINT chk_duration_positive
  CHECK (duration_seconds >= 0 OR duration_seconds IS NULL);
ALTER TABLE media_assets ADD CONSTRAINT chk_size_positive CHECK (size_bytes > 0);
ALTER TABLE payment_methods ADD CONSTRAINT chk_exp_month CHECK (exp_month BETWEEN 1 AND 12);

-- Performance indexes
CREATE INDEX idx_users_email ON users (email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_phone ON users (phone) WHERE phone IS NOT NULL;

-- Prevent duplicate active consultations
CREATE UNIQUE INDEX idx_active_consultation ON consultations (customer_id, expert_id)
  WHERE status IN ('requested', 'ringing', 'accepted', 'in_progress');
```

---

## Implementation Plan

### Phase 1: Critical Blockers (Days 1-2)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1.1 | Add `stripeAccountId` to Prisma schema + migration | `schema.prisma`, new migration | 15min |
| 1.2 | Persist `account.id` in `submitCustomConnectKyc` | `billingService.js` | 10min |
| 1.3 | Add `conflict` import to engagement service | `engagementService.js` | 2min |
| 1.4 | Remove try/catch on quote creation Zod parse | `quotes.routes.js` | 2min |
| 1.5 | Add partial unique indexes on `User.email`/`User.phone` | New migration | 15min |
| 1.6 | Fix `internalServiceGuard` — always validate `SERVICE_SECRET` | `billing.routes.js` | 10min |
| 1.7 | Fix `getTransaction` IDOR for subscription transactions | `billingService.js` | 15min |
| 1.8 | Add Zod validation to `POST /auth/refresh` | `auth.routes.js` + new schema | 10min |

### Phase 2: Data Integrity & State Machines (Days 3-5)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 2.1 | Add transactions + `WHERE status =` to quote state transitions | `engagementService.js` | 1hr |
| 2.2 | Add transactions to consultation state changes | `engagementService.js` | 45min |
| 2.3 | Fix atomic rating update (raw SQL) | `engagementService.js` | 30min |
| 2.4 | Trigger billing capture from `endConsultation` | `engagementService.js` | 20min |
| 2.5 | Add Zod schemas to onboarding + settings + verification docs | `expert.schema.js`, routes | 45min |
| 2.6 | Wrap `submitOnboarding` and `submitVerificationDocuments` in transactions | `expertService.js` | 20min |
| 2.7 | Fix `estimatedCents` — enforce server minimum for holds | `billingService.js` | 10min |
| 2.8 | Add UUID validation middleware for route params | `shared/middleware/` | 30min |
| 2.9 | Fix registration TOCTOU (wrap in transaction, match both identifiers) | `userService.js` | 30min |

### Phase 3: Database Constraints (Day 6)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 3.1 | Add CHECK constraints migration (all monetary + rating + duration + size) | New migration (raw SQL) | 30min |
| 3.2 | Add email/phone performance indexes | Same migration | 5min |
| 3.3 | Add active consultation unique index | Same migration | 5min |
| 3.4 | Run migration against dev, verify seed still works | `pnpm db:migrate:dev` | 15min |

### Phase 4: Security Hardening (Days 7-9)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 4.1 | Fix media service cross-user access (relationship-based auth) | `mediaService.js` | 1hr |
| 4.2 | Add WebSocket revoked-session check | `messagingSocket.js`, `supportSocket.js` | 30min |
| 4.3 | Fix role persistence on RefreshToken or make role mandatory | `tokens.js`, schema | 45min |
| 4.4 | Add webhook event deduplication table + check | Schema + `billingService.js` | 45min |
| 4.5 | Require `refreshToken` in logout or revoke all | `userService.js` | 10min |
| 4.6 | Add `requirePermission` to admin SSE endpoint | `admin-service routes` | 5min |
| 4.7 | Fix ZegoCloud webhook signature verification (validate body or nonce store) | `zegoWebhook.js` | 30min |
| 4.8 | Fix quote creation to throw 404 on invalid expertId | `engagementService.js` | 10min |
| 4.9 | Add admin category CRUD Zod validation | `admin-service controllers` | 20min |

### Phase 5: Polish & Cleanup (Days 10-12)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 5.1 | Add quote expiration cron job | New file + ecosystem config | 1hr |
| 5.2 | Fix PM delete to detach from Stripe | `billingService.js` | 10min |
| 5.3 | Extend admin audit logging to all write operations | `admin-service controllers` | 1hr |
| 5.4 | Fix video token to require accepted/in_progress status | `engagementService.js` | 5min |
| 5.5 | Fix `addPaymentMethod` to fetch brand/last4 from Stripe | `billingService.js` | 15min |
| 5.6 | Fix `forgotPassword` fake response to use real OTP config TTL | `userService.js` | 5min |
| 5.7 | Remove legacy bcrypt refresh token fallback (schedule removal) | `tokens.js` | 10min |
| 5.8 | Add ExpertVerification unique constraint | Migration | 10min |
| 5.9 | Add duplicate active consultation prevention | Already in Phase 3 migration | — |

### Phase 6: Testing (Ongoing, parallel with each phase)

Add integration tests for:
- Concurrent quote acceptance (only one succeeds)
- Concurrent consultation end (consistent duration)
- Duplicate email registration race → 409
- Duplicate review → 409 (not 500)
- Invalid UUID in route params → 400
- Missing refreshToken in refresh → 401
- Invalid body on quote creation → 400
- KYC → bank account full flow
- `getTransaction` on another expert's subscription → 403
- Media asset access by conversation participant → 200
- Logout without token → error or revoke all
- Login with suspended user → 401 on refresh attempt

---

## Total Estimated Effort

| Phase | Days | Items |
|-------|------|-------|
| Phase 1: Critical Blockers | 1-2 | 8 tasks |
| Phase 2: Data Integrity | 3-5 | 9 tasks |
| Phase 3: DB Constraints | 6 | 4 tasks |
| Phase 4: Security Hardening | 7-9 | 9 tasks |
| Phase 5: Polish | 10-12 | 9 tasks |
| Phase 6: Testing | Ongoing | 12+ test cases |

**Total: ~12 working days for a single developer, or ~6 days with two developers working in parallel on independent phases.**

---

*This document supersedes the previous `XprtLink-Backend-Audit.md`. All findings from the prior audit have been reviewed — resolved items are documented in the "Previously Fixed" section; remaining items are incorporated into the current findings and implementation plan.*
