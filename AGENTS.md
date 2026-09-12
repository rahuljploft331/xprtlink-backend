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
| expert-service | Experts + verification + **search/discovery** + banners (`/experts/me/banners`, `GET /experts/banners/public`) |
| catalog-service | Categories + CMS + app-config + support tickets. **Banners are in expert-service, not here.** |
| engagement-service | Quotes + consultations + ZegoCloud webhooks (`zego_callback_logs`) |
| messaging-service | Chat realtime (Socket.IO only; no REST messages) |
| billing-service | Stripe payments + IAP subscriptions + payouts. **N5 fixed** (2026-09-10): `appleIapController.js` previously imported non-existent `decodeSignedTransaction` — now uses `SignedDataVerifier.verifyAndDecodeTransaction` (N3 also fixed). `appleWebhookController.js` stub replaced with real `verifyAndDecodeNotification`. |
| notification-service | Push / in-app. Write path fixed (`type` + `payload`). In-app dispatch triggers wired (T-018); FCM push (T-018b) + quote expiry cron (T-018c) still open. |
| media-service | Uploads (S3 presigned + base64 direct, up to 100MB) |
| admin-service | Super admin + **subadmin RBAC** + reports + audit-log read + broadcast + SSE events. All 13 previously-404 endpoints **closed** (B2′). |
| api-gateway | Ingress (no database connection); proxies all `/api/v1/*` + WebSocket |

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
pnpm sync-remote-db   # SSH dump of remote Postgres → overwrite local DATABASE_URL
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
5. **Add all user-facing strings to `shared/constants/messages.json` first** (see rule below)
6. Update `postman.json` and sync (see `docs/postman-collections-reference.md`)

## API response messages — SSOT

**`shared/constants/messages.json` is the single source of truth for every string that reaches a client.**

### Rules (mandatory for every agent, every PR)

- **Never hardcode a prose string** inside an error helper call, `res.json()`, or `AppError` constructor.  
  ❌ `throw notFound("Expert not found")`  
  ✅ `throw notFound("expertNotFound")`

- **Before writing a new user-facing string**, add its camelCase key to `messages.json`.  
  Parameterised strings use `{placeholder}` syntax — `getMessage()` interpolates them.  
  ```js
  // messages.json
  "insufficientPermissionForModule": "Insufficient permission for module: {module}"

  // call site
  throw forbidden("insufficientPermissionForModule", "FORBIDDEN", null, { module })
  ```

- **Error helpers** (`notFound`, `unauthorized`, `forbidden`, `badRequest`, `conflict` in `shared/utils/errors.js`) accept a **message key** as their first argument and resolve it via `getMessage()` internally.  
  `badRequest` and `forbidden` also accept an optional 4th `params` object for interpolation.

- **`errorHandler.js`** (Prisma-mapped errors, `notFoundHandler`, Zod fallback) — already uses `getMessage()`. Keep it that way; do not add hardcoded strings.

- **Verify** before committing: run this one-liner to confirm every key you used exists in `messages.json`:
  ```bash
  node -e "
    const fs = require('fs'), path = require('path');
    const keys = new Set(Object.keys(JSON.parse(fs.readFileSync('shared/constants/messages.json','utf8'))));
    const src = require('child_process').execSync('grep -rn --include=\"*.js\" getMessage services', {encoding:'utf8'});
    const missing = [...src.matchAll(/getMessage\(\"([^\"]+)\"/g)]
      .map(m => m[1]).filter(k => !keys.has(k));
    if (missing.length) { console.error('Unknown keys:', missing); process.exit(1); }
    else console.log('✅ All message keys valid');
  "
  ```



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

Manual accept before paid session. Listed expert rate is **per 30 minutes**. Convert duration to whole minutes (`ceil(seconds / 60)`), then `charge = minutes × rate / 30`. Same duration for customer charge, expert earnings, and commission.

## Apple IAP env vars (billing-service)

After the N5 + N3 fix (2026-09-10) the following env vars drive Apple IAP verification. Add to `.env.example`:

```
APPLE_ISSUER_ID=       # App Store Connect → Keys → Issuer ID
APPLE_KEY_ID=          # App Store Connect → Keys → Key ID
APPLE_PRIVATE_KEY=     # PEM content with \n escaped as \\n
APPLE_BUNDLE_ID=       # com.xprtlink.app
APPLE_APP_ID=          # Numeric App Store Connect App ID (optional — needed for OCSP in prod)
APPLE_ROOT_CA_PEM=     # Base64-encoded Apple Root CA PEM (production); leave empty in sandbox
```

- `enableOnlineChecks` is `true` in `NODE_ENV=production` (OCSP revocation) and `false` in sandbox/dev.
- `APPLE_ROOT_CA_PEM` accepts multiple certs separated by `;`.
