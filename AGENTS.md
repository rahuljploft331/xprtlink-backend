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
pnpm init:flows             # seed prereqs + run all 4 verified Postman flows
pnpm init:flows:fresh       # wipe DB first, then seed + run flows (clean slate)
pnpm init:flows -- --flow A # run only flow A (A=Expert phone, B=Expert email,
                             #   C=Customer, D=Subscription lifecycle)
pnpm init:flows -- --no-seed  # skip platform seed, just run flows
```

**init:flows** runs these 4 verified collections against the live backend (Newman):
- **Flow A**: Expert Onboarding (phone OTP) — `scripts/flows/expert-onboarding-phone.flow.json`
- **Flow B**: Email Expert Onboarding — `scripts/flows/expert-onboarding-email.flow.json`
- **Flow C**: Customer Onboarding & Quote Flow — `scripts/flows/customer-onboarding.flow.json`
- **Flow D**: Expert Subscription Lifecycle (13 steps) — `scripts/flows/expert-subscription-lifecycle.flow.json`

Needs: `pm2 start` first, `DATABASE_URL` in `.env`, `newman` (auto-installed if missing).

## Secrets

`getSecret` / `getSecretSync` — env today, AWS Secrets Manager later.

## Conventions

- Commit changes once done with a descriptive commit message.
