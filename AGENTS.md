# XprtLink Backend — Agent Guide

## Layout

- `services/<name>/` — one Express microservice each
- `shared/` — `@xprtlink/shared` (config, middleware, utils, constants)
- `ecosystem.config.cjs` — PM2 process list
- Root `.env` injected by PM2 / dotenv-cli

## Ports

See README. Gateway is `:4000`.

## Adding a route

1. Put handlers in `src/controllers/`
2. Mount under `src/routes/index.js` at `/api`
3. Use `ResponseFormatter` from `@xprtlink/shared/utils/responseFormatter.js`
4. Keep gateway public paths as `/api/v1/<domain>/*` (proxy later)

## Bootstrap pattern

```js
import { getConfig } from "@xprtlink/shared/config/loadEnv.js";
import { createApp, startService } from "@xprtlink/shared/config/serviceTemplate.js";
```

## Do not (yet)

- Add Mongo/Postgres/Redis models or connections (DB deferred)
- Commit real secrets
- Implement full business features unless asked

## Secrets

`getSecret` / `getSecretSync` in `shared/config/secrets.js` — env today, AWS Secrets Manager later.
