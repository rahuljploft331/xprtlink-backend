# XprtLink Backend

pnpm workspace of Express microservices for the XprtLink platform.

## Stack

- Node.js (ESM) + Express
- pnpm workspaces (`services/*` + `shared`)
- PM2 (`ecosystem.config.cjs`)
- Shared package: `@xprtlink/shared`

**Database / Redis:** deferred — not wired in this scaffold.

## Services & ports

| Service | Port |
|---------|------|
| api-gateway | 4000 |
| user-service | 4001 |
| catalog-service | 4002 |
| search-service | 4003 |
| quote-service | 4004 |
| messaging-service | 4005 |
| consultation-service | 4006 |
| payment-service | 4007 |
| subscription-service | 4008 |
| notification-service | 4009 |
| media-service | 4010 |
| admin-service | 4011 |
| reporting-service | 4012 |

## Setup

```bash
cp .env.example .env
pnpm install
pnpm pm2:start
# or: pnpm --filter @xprtlink/user-service dev
```

Health check example:

```bash
curl http://localhost:4001/health
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm pm2:start` | Start all services via PM2 |
| `pnpm pm2:stop` | Stop all |
| `pnpm pm2:restart` | Restart all |
| `pnpm pm2:logs` | Tail logs |
| `pnpm pm2:status` | Status |
| `pnpm env:check` | Soft env validation |

## Secrets

Use `.env` locally. `shared/config/secrets.js` is the abstraction point for a future **AWS Secrets Manager** migration.

See [AGENTS.md](./AGENTS.md) for conventions.
