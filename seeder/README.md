# XprtLink Seeder

Local demo data for resetting the backend to a known baseline.

## Commands

From `xpertlink-backend/`:

```bash
pnpm seed          # write seed state (file + Mongo if configured)
pnpm reset         # wipe seed state then reseed
pnpm reset -- --no-seed   # wipe only
```

## What gets seeded

| Dataset | Notes |
|---------|--------|
| admins | Super Admin + Subadmins (RBAC permissions) |
| customers | Demo customer accounts |
| experts | Demo experts + verification/plan fields |
| categories | Marketplace categories |
| cmsPages / platformConfig / subscriptionPlans | Platform defaults |

## Storage

1. **Always** — `seeder/.data/seed-state.json` (gitignored file store)
2. **Optional** — MongoDB collections when `MONGODB_URI` is set in `.env`

## Demo passwords (local only)

| Account | Password |
|---------|----------|
| admin@xpertlink.local | Admin@123 |
| support@xpertlink.local | Support@123 |
| finance@xpertlink.local | Finance@123 |
| *customers* | Customer@123 |
| *experts* | Expert@123 |

Never use these in production.
