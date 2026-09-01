# XprtLink Backend — Agent Guide

## Layout

- `services/<name>/` — Express microservices
- `shared/` — `@xprtlink/shared` (Prisma, contracts, mappers, db)
- `shared/prisma/schema.prisma` — PostgreSQL schema (single shared DB)
- `ecosystem.config.cjs` — PM2
- Root `.env` via PM2 / dotenv-cli (`loadEnv.js` does **not** load `.env` by itself)

## Service map (do not re-split without asking)

| Service | Responsibility |
|---------|----------------|
| user-service | Auth + customers |
| expert-service | Experts + verification + **search/discovery** |
| catalog-service | Categories + CMS. **Not banners** (no banner model or route — G1) |
| engagement-service | Quotes + consultations |
| messaging-service | Chat realtime (Socket.IO only; no REST messages) |
| billing-service | Stripe payments + IAP subscriptions + payouts |
| notification-service | Push / in-app. Write path fixed (`type` + `payload`). In-app dispatch triggers wired (T-018); FCM push + admin broadcast still open |
| media-service | Uploads |
| admin-service | Super admin + **subadmin RBAC** + reports. Audit **writes** only (no read API — G7) |
| api-gateway | Ingress (no database connection) |

## Database (PostgreSQL + Prisma)

- **One database** (`DATABASE_URL`) — each service process opens its **own pool** via `getDb()`
- Domain repositories: `shared/db/repositories/<domain>/`
- API responses: `shared/mappers/` (never Prisma objects). Expert public DTO: **`categories[]`**, `availabilityStatus`, `isFeatured`
- Validate with `shared/contracts/` (Zod, camelCase)
- Enums: `shared/constants/enums.js`

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

## Adding a route

1. Controllers in `src/controllers/`
2. Mount under `src/routes` at `/api` **and** add the gateway proxy path
3. `ResponseFormatter` — paginated lists use `data: { items, page, limit, total }`
4. Return DTOs via mappers
5. Update `postman.json` and sync (see `docs/postman-collections-reference.md`)

## Featured / trending

`GET /api/v1/experts/featured` — configurable: admin-pinned (`isFeatured`, expiry-aware, `featuredRank`) then subscription-tier backfill (`top_5` > `top_25` > `listing`), rating as tiebreaker only.

`GET /api/v1/experts/trending` aliases `getFeatured()`. **Deliberate.** Aug 31 decision: do not build a separate Trending product. Do not invent a trending algorithm. Keep both routes **before** `/:id`. Clamp `limit` with `parsePagination`.

Ranking direction is **rotating / fair exposure** (OFD-003 open). `featuredRank` is a temporary admin pin, not the intended model. Do not hardcode Elite = first.

Known bug (B6): do not over-fetch the backfill pool ordered by rating *before* sorting by tier — that can exclude Elite subscribers.

Related: MFS §9.6.3 **Top Rated Experts** has no endpoint (G2). Advertisement packages are not started (OFD-002). See `docs/MFS-implementation-audit.md`.

## Do not

- Commit secrets (`.env`)
- Split billing/expert/search back into tiny services unless product asks
- Write across another service's tables without going through repositories
- Re-implement featured as a hardcoded top-rated list
- Restrict chat to templates or message counts; do not add image/video to standard chat

## Seed & reset (local baseline)

```bash
pnpm seed          # file store + PostgreSQL when DATABASE_URL is set
pnpm reset         # truncate + reseed
pnpm reset -- --no-seed   # wipe only

pnpm seed:platform          # system prereqs only
pnpm init:flows             # seed prereqs + Newman flows B–F
pnpm init:flows:fresh       # wipe DB first, then seed + run flows
pnpm init:flows -- --flow B # single flow (B, C, D, E, or F)
pnpm init:flows -- --no-seed
pnpm flow:chat              # Flow G (Socket.IO) — not in the Newman runner
```

Newman flows: **B** email expert, **C** customer+quote, **D** subscription lifecycle, **E** verification approval, **F** consultation lifecycle. There is **no Flow A** in `scripts/init-flows.js`.

Needs: services running, `DATABASE_URL` in `.env`.

## Rate limiting

Dev `.env` uses high limits so `init:flows` is not 429’d. Production must use strict values. `pm2 restart` does **not** reload `.env` — use `pm2 delete all && pm2 start ecosystem.config.cjs`.

## Secrets

`getSecret` / `getSecretSync` — env today, AWS Secrets Manager later.

## Consultations / billing (Aug 31)

Manual accept before paid session. Per-minute billing; partial minutes **round up**. Same duration for customer charge, expert earnings, and commission.
