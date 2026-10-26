# Deployment notes (for later; nothing here has been executed)

No deploy, release, publish or install has been performed by the development workflow. The owner runs
`shopify app deploy` themselves, after the manual checklist passes.

## Distribution

| | Public (App Store) | Custom |
|---|---|---|
| Production path | **Yes (intended)** | Only one store, or stores in one Plus organization |
| Functions on non-Plus stores | Yes | **No** (Plus only) |
| Dev-store testing | Yes | Yes |
| Review | Required | None |

Distribution cannot be changed after it is chosen. `app/shopify.server.js` already uses `AppDistribution.AppStore`.
The distribution type of the existing app in the Dev Dashboard is **unknown**: confirm it is public, or create a new
public app and `shopify app config link` to it **before the first deploy**.

App Store requirements already handled in code: subscriptions to `customers/data_request`, `customers/redact` and
`shop/redact` (HMAC-verified, invalid → 401, all return 200). `application_url` and `redirect_urls` in
`shopify.app.toml` are `https://example.com` placeholders and must be real URLs at review time. Listing, demo store,
screenshots and billing are launch tasks outside v1.

## Environment variables

`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES` (`read_products,write_discounts`), `SHOPIFY_APP_URL`,
`DATABASE_URL`. Optional: `SHOP_CUSTOM_DOMAIN`. Keep them in the host's secret store; never commit them.

## PostgreSQL (required in production)

SQLite is for local development only.

```bash
node scripts/gen-postgres-schema.mjs                 # keep prisma/postgres/schema.prisma in sync
# first time against an empty database:
DATABASE_URL=postgresql://… npx prisma migrate deploy --schema prisma/postgres/schema.prisma
```

`prisma/postgres/migrations/0001_baseline` was generated with
`prisma migrate diff --from-empty --to-schema-datamodel prisma/postgres/schema.prisma --script` and has **not** been
applied to a real server. For later schema changes, add a PostgreSQL migration alongside the SQLite one (see README).
Existing local sessions are not migrated; production starts clean and merchants re-authorize via token exchange.

The `Dockerfile` / `docker-start` script currently run `prisma migrate deploy` against the SQLite schema. Switching
them to `--schema prisma/postgres/schema.prisma` is required before a container deploy and has deliberately **not**
been changed yet.

Multi-instance hosting additionally needs a shared store for the app-proxy rate limiter (currently in-memory).

## Deploy steps (owner, in order)

1. Pass `docs/manual-test-checklist.md` on a development store (`npm run dev`).
2. Confirm/choose public distribution; set real `application_url` / redirect URLs.
3. Provision PostgreSQL; set env vars; apply the PostgreSQL migrations.
4. `npx shopify app config validate`, then `npx shopify app deploy` (creates an app version including the Function
   and theme extension). Review the scope change from the old template scopes in the CLI prompt.
5. Install on the dev store; add the Bundle block in the theme editor; create and activate a bundle.

## Purchase attribution and revenue

Implemented locally, **unverified against Shopify** (see [revenue-tracking.md](revenue-tracking.md)). It needs the
`read_orders` scope (already in `shopify.app.toml`) and protected customer data access (Level 1) for the app, which
Shopify must grant before any order can be read. Order webhooks are not subscribed (they need the same approval).
