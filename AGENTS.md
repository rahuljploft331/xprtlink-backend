# XprtLink Backend — Agent Guide

## Layout

- `services/<name>/` — Express microservices (consolidated set — see README)
- `shared/` — `@xprtlink/shared`
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
| api-gateway | Ingress |

## Admin / subadmin RBAC

Constants: `ADMIN_ROLES`, `ADMIN_MODULES`, `ADMIN_PERMISSION_LEVELS` in `shared/constants/index.js`.

- `super_admin` — full access
- `subadmin` — per-module `view | edit | none` (MFS §12.11)
- Admin UI must filter nav/routes by these permissions when auth is wired

## Adding a route

1. Controllers in `src/controllers/`
2. Mount under `src/routes` at `/api`
3. `ResponseFormatter` from shared
4. Public gateway paths: `/api/v1/<domain>/*`

## Do not (yet)

- Full shared Mongoose models / Redis wiring into services
- Commit secrets
- Split billing/expert/search back into tiny services unless product asks

## Seed & reset (local baseline)

```bash
pnpm seed          # write seeder/.data/seed-state.json (+ Mongo if MONGODB_URI set)
pnpm reset         # wipe seed state then reseed — use whenever you want a clean backend demo
pnpm reset -- --no-seed   # wipe only
```

Seed source: `seeder/data/*` · Guide: `seeder/README.md`  
Includes super_admin + subadmin demo accounts.

## Secrets

`getSecret` / `getSecretSync` — env today, AWS Secrets Manager later.
