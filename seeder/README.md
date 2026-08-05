# XprtLink Seeder

Local demo data for resetting the backend to a known baseline.

## Commands

From `xpertlink-backend/`:

```bash
pnpm seed          # write seed state (file + PostgreSQL when DATABASE_URL is set)
pnpm reset         # truncate Postgres + reseed
pnpm reset -- --no-seed   # wipe only
```

## What gets seeded

| Dataset | Notes |
|---------|--------|
| admins | Super Admin + Subadmins (RBAC permissions) |
| customers | Demo customer accounts + `users` / `customer_profiles` |
| experts | Demo experts + verification, subscriptions, `expert_profiles` |
| categories | Marketplace categories |
| cmsPages / platformConfig / subscriptionPlans / appConfig | Platform defaults |

## Storage

1. **Always** — `seeder/.data/seed-state.json` (gitignored file store)
2. **PostgreSQL** — when `DATABASE_URL` is set in `.env` (see `seeder/lib/pg.js`)

## Demo passwords (local only)

| Account | Password |
|---------|----------|
| admin@xpertlink.local | Admin@123 |
| support@xpertlink.local | Support@123 |
| finance@xpertlink.local | Finance@123 |
| *customers* | Customer@123 |
| *experts* | Expert@123 |

Never use these in production.
