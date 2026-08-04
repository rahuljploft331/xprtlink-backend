# Architecture (scaffold)

```text
Clients (Flutter / Admin)
        │
        ▼
  api-gateway :4000
        │  /api/v1/<domain>/*  (proxy rewrite — TBD)
        ▼
  Downstream services :4001–4012
        │
        ├── @xprtlink/shared (config, middleware, utils)
        └── DB / Redis — deferred
```

## Communication (planned)

- **Ingress:** HTTP via api-gateway
- **Internal:** HTTP + `x-service-secret` / `x-internal-service` headers
- **Realtime:** messaging-service (Socket.IO) — not implemented yet
- **Async:** Redis / queues — deferred with cache decision

## Response contract

```json
{ "success": true, "message": "...", "data": {} }
```

Errors:

```json
{ "success": false, "message": "...", "code": "ERROR" }
```
