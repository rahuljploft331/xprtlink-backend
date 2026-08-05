# Architecture (scaffold)

```text
Clients (Flutter / Admin)
        │
        ▼
  api-gateway :4000
        │  /api/v1/<domain>/*  (proxy rewrite — TBD)
        ▼
  Downstream services :4001–4009
        │
        ├── user-service        auth, customers
        ├── expert-service      profiles, verification, search/discovery
        ├── catalog-service     categories, CMS
        ├── engagement-service  quotes + consultations
        ├── messaging-service   chat
        ├── billing-service     payments + subscriptions + payouts
        ├── notification-service
        ├── media-service
        └── admin-service       super_admin + subadmins + reports
        │
        ├── @xprtlink/shared
        └── DB / Redis — deferred
```

## Why no dedicated search-service?

Customer “Search” screens (MFS §9) filter/sort **experts** by category, price, rating, distance, plan visibility, online status. That logic belongs next to expert data → **expert-service**.

## Admin RBAC

- Super admin: full module access
- Subadmin: page-level `view | edit | none` on modules listed in `ADMIN_MODULES`

## Response contract

```json
{ "success": true, "message": "...", "data": {} }
```
