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
pnpm seed          # file store + PostgreSQL when DATABASE_URL is set
pnpm reset         # truncate + reseed
pnpm reset -- --no-seed   # wipe only
```

Seed source: `seeder/data/*` · Guide: `seeder/README.md`  
Includes super_admin + subadmin demo accounts.

## Secrets

`getSecret` / `getSecretSync` — env today, AWS Secrets Manager later.
