# XprtLink Backend

pnpm workspace of Express microservices for the XprtLink platform.

## Stack

- Node.js (ESM) + Express
- pnpm workspaces (`services/*` + `shared`)
- PM2 (`ecosystem.config.cjs`)
- Shared package: `@xprtlink/shared`

**Database / Redis:** deferred — not wired in this scaffold.

## Consolidated services (10)

| Service | Port | Owns |
|---------|------|------|
| api-gateway | 4000 | Ingress / proxy |
| user-service | 4001 | Auth, customers, shared identity |
| expert-service | 4002 | Expert profiles, verification, availability, **search/discovery** |
| catalog-service | 4003 | Categories, banners, CMS |
| engagement-service | 4004 | Quotes + consultations (+ review submit) |
| messaging-service | 4005 | Chat / Socket.IO |
| billing-service | 4006 | Payments + subscriptions + payouts |
| notification-service | 4007 | Push / in-app / blasts |
| media-service | 4008 | S3 signed uploads |
| admin-service | 4009 | Super admin + **subadmins** (RBAC), audit, reports |

### Merges vs earlier scaffold

- `search-service` → **expert-service** (discovery is expert ranking/filters)
- `payment-service` + `subscription-service` → **billing-service**
- `quote-service` + `consultation-service` → **engagement-service**
- `reporting-service` → **admin-service**

## Setup

```bash
cp .env.example .env
pnpm install
pnpm seed            # demo baseline (admins, customers, experts, categories…)
pnpm pm2:start
```

### Reset anytime

```bash
pnpm reset           # wipe local seed (+ Mongo if configured) and reseed
pnpm pm2:restart     # optional — reload services after reset
```

See [`seeder/README.md`](./seeder/README.md).

## Secrets

Use `.env` locally. `shared/config/secrets.js` is the abstraction for a future **AWS Secrets Manager** migration.

See [AGENTS.md](./AGENTS.md).
