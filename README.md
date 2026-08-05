# XprtLink Backend

pnpm workspace of Express microservices for the XprtLink platform.

## Stack

- Node.js (ESM) + Express
- pnpm workspaces (`services/*` + `shared`)
- PM2 (`ecosystem.config.cjs`)
- **PostgreSQL** + Prisma (`@xprtlink/shared`)
- Shared package: `@xprtlink/shared`

## Consolidated services (10)

| Service | Port | Owns |
|---------|------|------|
| api-gateway | 4000 | Ingress / proxy (no DB) |
| user-service | 4001 | Auth, customers, shared identity |
| expert-service | 4002 | Expert profiles, verification, availability, **search/discovery** |
| catalog-service | 4003 | Categories, banners, CMS |
| engagement-service | 4004 | Quotes + consultations (+ review submit) |
| messaging-service | 4005 | Chat / Socket.IO |
| billing-service | 4006 | Payments + subscriptions + payouts |
| notification-service | 4007 | Push / in-app / blasts |
| media-service | 4008 | S3 signed uploads |
| admin-service | 4009 | Super admin + **subadmins** (RBAC), audit, reports |

## Setup

From the **umbrella root** (`xpertlink/`), start PostgreSQL:

```bash
docker compose up -d     # PostgreSQL on localhost:5432 (root docker-compose.yml)
```

Then in `xpertlink-backend/`:

```bash
cp .env.example .env
pnpm install
pnpm db:migrate:dev      # first-time: create tables
pnpm seed                # demo baseline (admins, customers, experts, categories…)
pnpm pm2:start
```

### Database commands

```bash
pnpm db:generate         # Prisma client after schema changes
pnpm db:migrate          # apply migrations (deploy)
pnpm db:migrate:dev      # create + apply migration (development)
pnpm db:studio           # Prisma Studio GUI
```

### Reset anytime

```bash
pnpm reset               # truncate Postgres + reseed (+ file store)
pnpm reset -- --no-seed  # wipe only
pnpm pm2:restart         # optional — reload services after reset
```

See [`seeder/README.md`](./seeder/README.md) and [`../docs/database-schema.md`](../docs/database-schema.md).

## Secrets

Use `.env` locally. `shared/config/secrets.js` is the abstraction for a future **AWS Secrets Manager** migration.

See [AGENTS.md](./AGENTS.md).
