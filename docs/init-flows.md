# Init Flows — API-Driven Data Population

> Replaces the static seeder with real API calls via Newman (Postman CLI runner).  
> Source of truth: `scripts/flows/*.flow.json`

---

## Quick Reference

```bash
# Full fresh start: wipe DB + seed platform prereqs + run all 4 flows
pnpm init:flows --fresh

# Just run flows (platform prereqs already exist)
pnpm init:flows --no-seed

# Run a single flow
pnpm init:flows --flow A    # Expert Onboarding (Phone OTP)
pnpm init:flows --flow B    # Expert Onboarding (Email OTP)
pnpm init:flows --flow C    # Customer Onboarding & Quote
pnpm init:flows --flow D    # Expert Subscription Lifecycle (13 steps)
```

---

## What Each Flow Creates

| Flow | File | Records Created |
|------|------|-----------------|
| **A** | `expert-onboarding-phone.flow.json` | Expert (phone OTP) + profile + verification docs + Elite subscription |
| **B** | `expert-onboarding-email.flow.json` | Expert (email OTP) + profile + passport verification + Elite subscription |
| **C** | `customer-onboarding.flow.json` | Customer + profile + payment method + quote request to an expert |
| **D** | `expert-subscription-lifecycle.flow.json` | Expert through full subscribe → upgrade → cancel → reinstate cycle |

---

## Running in Postman

These flow collections also exist in the **Xpertlink Team Workspace** on Postman cloud:
- Flow A: Expert Onboarding (Phone OTP)
- Flow B: Expert Onboarding (Email OTP)
- Flow C: Customer Onboarding & Quote
- Flow D: Expert Subscription Lifecycle

**Important:** Run them using the **Collection Runner** (click "Run" on a collection), NOT the Postman Flows visual builder. Select **No Environment** — the scripts use `pm.collectionVariables` internally.

---

## Platform Prerequisites (seeded by `seed-platform.js`)

| Data | Count |
|------|-------|
| Categories | 5 |
| Subscription Plans (Stripe-synced) | 3 (Core $9.99, Professional $29.99, Elite $49.99) |
| Platform Settings | 5 |
| App Config | 1 |
| CMS Pages | 5 |
| Admin Users | 3 (1 super_admin + 2 subadmins) |

---

## Flows Still Needed (Based on Figma & MFS)

The following user journeys from the Figma UI designs are **not yet covered** by automated flows:

| Flow | Figma Screen / MFS Section | Priority |
|------|---------------------------|----------|
| **E. Expert Verification Approval** | Admin approves pending expert → expert becomes search-eligible | High |
| **F. Consultation Lifecycle** | Customer requests consultation → expert accepts → video call → payment → review | High |
| **G. Messaging / Chat** | Customer ↔ Expert real-time messaging with attachments | Medium |
| **H. Expert Payout Cycle** | Consultation earnings → weekly payout → Stripe Connect transfer | Medium |
| **I. Customer Quote Acceptance** | Expert responds to quote → customer accepts → consultation scheduled | Medium |
| **J. Admin Moderation** | Admin reviews flagged content, suspends users, manages CMS | Low |
| **K. Expert Availability Toggle** | Expert goes online/offline, availability status changes | Low |
| **L. Password Reset / Account Recovery** | Forgot password → OTP → reset | Low |
| **M. Social Login (Google/Apple)** | Social auth → phone collection → account creation | Low |

### Why these matter for the admin panel:

- **E** (Verification Approval): Without this, experts stay "pending" forever — admin Verifications page has nothing to approve
- **F** (Consultation Lifecycle): Populates Consultations, Payments, Reviews, and Earnings admin pages
- **G** (Messaging): Populates the future Messaging/Support admin page
- **H** (Payouts): Populates the Payouts admin page with real payout records
- **I** (Quote Acceptance): Shows quote status transitions in the admin Quotes page

---

## Dev Notes

- OTP in dev is always `123456` (`OTP_ENABLE_HARDCODE=true`)
- Each flow generates unique emails/phones using `Date.now()` — safe to run multiple times
- Newman reports are saved to `logs/newman/` as JSON
- Backend must be running (`pnpm dev` or `pm2 start`) before running flows
- After `--fresh`, restart PM2 if services were running: `pm2 restart all`
