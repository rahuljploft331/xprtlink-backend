# XprtLink Backend — Agent Guide

## Layout

- `services/<name>/` — Express microservices (consolidated set — see README)
- `shared/` — `@xprtlink/shared` (Prisma, contracts, mappers, db)
- `shared/prisma/schema.prisma` — PostgreSQL schema (single shared DB)
- `ecosystem.config.cjs` — PM2
- Root `.env` via PM2 / dotenv-cli

## Service map (do not re-split without asking)

| Service | Responsibility |
|---------|----------------|
| user-service | Auth + customers |
| expert-service | Experts + verification + **search/discovery** |
| catalog-service | Categories / CMS / banners |
| engagement-service | Quotes + consultations |
| messaging-service | Chat realtime |
| billing-service | Stripe payments + IAP subscriptions + payouts |
| notification-service | Push / in-app |
| media-service | Uploads |
| admin-service | Super admin + **subadmin RBAC** + reports + audit |
| api-gateway | Ingress (no database connection) |

## Database (PostgreSQL + Prisma)

- **One database** (`DATABASE_URL`) — each service process opens its **own pool** via `getDb()` from `@xprtlink/shared/db`
- Schema + migrations: `shared/prisma/`
- Domain repositories: `shared/db/repositories/<domain>/`
- API responses: map DB rows with `shared/mappers/`; validate with `shared/contracts/` (Zod, camelCase for Flutter)
- Enums: `shared/constants/enums.js` (mirrors Prisma enums)

```bash
pnpm db:generate      # after schema edits
pnpm db:migrate:dev   # new migration in dev
pnpm db:migrate       # deploy migrations
pnpm seed / pnpm reset
```

## Admin / subadmin RBAC

Constants: `ADMIN_ROLES`, `ADMIN_MODULES`, `ADMIN_PERMISSION_LEVELS` in `shared/constants/index.js`.

- `super_admin` — full access
- `subadmin` — per-module `view | edit | none` (MFS §12.11)
- Admin UI must filter nav/routes by these permissions when auth is wired

## Adding a route

1. Controllers in `src/controllers/`
2. Mount under `src/routes` at `/api`
3. `ResponseFormatter` from shared — paginated lists use `data: { items, page, limit, total }`
4. Return DTOs via mappers; do not expose Prisma objects directly
5. Public gateway paths: `/api/v1/<domain>/*`

## Expert discovery: `/featured` and `/trending` (both required — do not merge or delete)

`GET /api/v1/experts/featured` and `GET /api/v1/experts/trending` are **both required
endpoints**. `getTrending()` currently delegates straight to `getFeatured()`
(`services/expert-service/src/services/expertService.js`).

**This is deliberate, not a bug or leftover stub.** The trending business logic has **not been
cleared by the client yet**, so trending intentionally mocks the featured response to unblock
the Flutter team's integration — they can wire the real endpoint and URL now, and the payload
shape will not change when the algorithm lands.

Rules for agents:
- **Do not** delete `/trending`, collapse it into `/featured`, or "fix" the delegation as
  duplicated code. Both endpoints stay, and the delegation stays until the client signs off.
- **Do not** invent a trending algorithm. When the client clears it, only the body of
  `getTrending()` changes; the route, contract, and response shape stay as they are.
- Keep both routes declared **before** `/:id` in `experts.routes.js` or the UUID param route
  will shadow them.
- Both routes should clamp `limit` with `parsePagination` (`shared/utils/pagination.js`) —
  a raw `parseInt` lets `?limit=abc` reach Prisma as `NaN` and `?limit=500000` trigger a
  multi-million-row over-fetch on a public, unauthenticated endpoint.

Related open item: "Trending" does not appear in the MFS; §9.6.3 specifies a **Top Rated
Experts** rail that has no endpoint. Confirm with the client whether trending and top-rated
are the same rail before building either algorithm. See `docs/MFS-implementation-audit.md`.

## Do not

- Commit secrets (`.env`)
- Split billing/expert/search back into tiny services unless product asks
- Write across another service's tables without going through repositories

## Seed & reset (local baseline)

```bash
# ── Legacy static seeder (dummy data) ──────────────────────────────────────
pnpm seed          # file store + PostgreSQL when DATABASE_URL is set
pnpm reset         # truncate + reseed (dummy data)
pnpm reset -- --no-seed   # wipe only

# ── API-Driven Init (real data via Newman flows) ────────────────────────────
pnpm seed:platform          # seed only system prereqs (categories, plans, admins)
pnpm init:flows             # seed prereqs + run all 5 verified Postman flows
pnpm init:flows:fresh       # wipe DB first, then seed + run flows (clean slate)
pnpm init:flows -- --flow B # run only flow B (B=Expert email, C=Customer,
                             #   D=Subscription lifecycle, E=Verification, F=Consultation)
pnpm init:flows -- --no-seed  # skip platform seed, just run flows
```

**init:flows** runs these 5 verified collections against the live backend (Newman):
- **Flow B**: Email Expert Onboarding — `scripts/flows/expert-onboarding-email.flow.json`
- **Flow C**: Customer Onboarding & Quote Flow — `scripts/flows/customer-onboarding.flow.json`
- **Flow D**: Expert Subscription Lifecycle (13 steps) — `scripts/flows/expert-subscription-lifecycle.flow.json`
- **Flow E**: Expert Verification Approval — `scripts/flows/expert-verification-approval.flow.json`
- **Flow F**: Consultation Lifecycle (12 steps) — `scripts/flows/consultation-lifecycle.flow.json`

Needs: `pm2 start` first, `DATABASE_URL` in `.env`, `newman` (auto-installed if missing).

## Rate Limiting

Dev `.env` uses intentionally high rate-limit values (`RATE_LIMIT_AUTH_MAX=200`, `RATE_LIMIT_OTP_MAX=100`, etc.) so that `pnpm init:flows` and automated test runs don't get blocked by the per-IP limiter. This is fine for development — production deployments must use strict values (see `.env.example` comments).

If flows still fail with 429 after repeated runs without a PM2 restart, just `pm2 delete all && pm2 start ecosystem.config.cjs` — the in-memory express-rate-limit store resets with the process. Note: `pm2 restart` does NOT reload `.env` changes — only `pm2 delete` + `pm2 start` picks up new env values.

## Secrets

`getSecret` / `getSecretSync` — env today, AWS Secrets Manager later.

## Conventions

- Commit changes once done with a descriptive commit message.
