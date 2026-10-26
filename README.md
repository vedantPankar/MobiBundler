# MobiBundler

Embedded Shopify app for **fixed-product bundles** with a percentage or fixed-amount-off discount.
React Router 7 + Prisma on the Shopify CLI app template, a theme app extension (`bundler-storefront`) and a
Shopify Function (`bundle-discount`).

> **Status: v1 implemented locally and tested offline. It has never been run against a Shopify store.**
> Everything that depends on live Shopify behavior is listed under [Unverified behavior](#unverified-behavior)
> and must be checked with [docs/manual-test-checklist.md](docs/manual-test-checklist.md) before release.
> Nothing has been deployed or published.

## How it works

1. A merchant creates a bundle in the admin (`/app/bundles/new`): 2–10 product variants (quantity 1–99 each), a
   percentage or fixed-amount discount, and optional storefront display settings. The server re-fetches every
   variant from the Admin API and rejects anything it cannot find.
2. Bundles live in the app database (source of truth). On activate/pause/archive/save, `app/bundles/sync.server.ts`
   writes **one shared automatic app discount per shop** whose metafield carries every active bundle
   (`{ v: 1, bundles: [...] }`). The write is skipped when the config hash is unchanged.
3. The `bundler-storefront` block fetches display data through the app proxy (`/apps/mobi-bundler/bundles`) and
   adds every component to the cart with `/cart/add.js`. It never sends a price.
4. At checkout the `bundle-discount` Function runs `allocate()` (`extensions/bundle-discount/src/engine.ts`) over
   the cart and the saved config. Eligibility comes from variant ids and quantities only; line properties, client
   prices and submitted bundle ids are ignored. A shopper who assembles the same variants by hand gets the same
   discount (a bundle is a composition).

Engine rules: units are pooled per variant across lines; a bundle needs all its components in sufficient
quantity (partial bundles get nothing); `sets = min(floor(available / required))`; extra units stay full price;
overlapping bundles are resolved deterministically (highest saving per set first, then id) and no unit is
discounted twice; fixed amounts are clamped to the subtotal and distributed with largest-remainder rounding; unknown
pricing kinds and invalid entries are skipped rather than failing checkout.

## Prerequisites

- Node `>=20.19 <22` or `>=22.12`, npm
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) 3.x and a Shopify Partners/Dev Dashboard account
- A **development store** you own (OS 2.0 theme) for manual verification
- No Rust toolchain is needed (the Function is TypeScript)

## Local setup

```bash
npm install
npx prisma generate
npx prisma migrate deploy      # applies prisma/migrations to prisma/dev.sqlite (additive; keeps Session data)
```

Never run `prisma migrate reset` or `db push --force-reset`: they delete the `Session` table's data.
Back up first if unsure: `cp prisma/dev.sqlite prisma/dev.sqlite.bak` (git-ignored).

Environment: `shopify app dev` supplies `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES` and `SHOPIFY_APP_URL`
when it runs. Do not create or commit a `.env` with real values (`.env*` is git-ignored).

## Commands

| Task | Command |
|---|---|
| Unit/integration tests (offline) | `npm test` |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |
| Production build | `npm run build` |
| Validate Prisma schemas | `npx prisma validate` and `DATABASE_URL=postgresql://x npx prisma validate --schema prisma/postgres/schema.prisma` |
| Validate app config | `npx shopify app config validate` |
| Build the Function | `cd extensions/bundle-discount && npm run build` |
| Run the Function on a fixture | `cd extensions/bundle-discount && npm exec shopify app function run -- --input tests/two-items.input.json --export cart-lines-discounts-generate-run` |
| Theme extension lint | `npx shopify theme check --path extensions/bundler-storefront` |
| Dev server (needs a dev store; **modifies the dev store's app install**) | `npm run dev` |

Do **not** run `npm run deploy` / `shopify app deploy` until the checklist passes and you have decided on
[distribution](docs/deployment.md#distribution).

## Tests

`npm test` runs Vitest. DB tests use a throwaway SQLite database built from the real migrations
(`prisma/.tmp-test/`, git-ignored) and never touch `prisma/dev.sqlite`; test files run serially because they share it.
Shopify calls are replaced with fakes, so these tests prove our logic, **not** live Shopify behavior.
Coverage: engine (percentage/fixed, partial bundles, duplicates, quantities, overlap, determinism, invalid config),
Function adapter and config parsing, validation, repository isolation, sync (idempotency, retry, concurrency),
save/variant re-verification, webhook handlers and routes (mocked `authenticate.webhook`), events, public bundle
data, rate limiting, storefront cart payload, diagnostics, and SQLite/PostgreSQL schema parity.

## Required API scopes

`read_products,write_discounts,write_app_proxy` (set in `shopify.app.toml`).

- `read_products`: search products and re-verify variants when saving, and read live titles/prices/stock.
- `write_discounts`: create/update/activate/deactivate the shared automatic app discount.
- `write_app_proxy`: the app-proxy docs state "Configuring an app proxy requires the `write_app_proxy` access scope"
  (`shopify.dev/docs/apps/build/online-store/app-proxies`), so it is requested for the `[app_proxy]` block.
- Not requested: `read_orders` (no purchase or revenue analytics), `write_products`.
- Changing scopes takes effect only after a deploy and merchant re-approval; nothing has been deployed.

## Database

Local development uses SQLite (`prisma/schema.prisma`, `prisma/dev.sqlite`). Models: `Session` (template, untouched),
`Bundle`, `BundleItem`, `BundleEvent`, `ShopDiscount`. Every table except `Session` carries `shop`; all bundle-table
queries live in `app/bundles/repo.server.ts` (enforced by `tests/noDirectPrisma.test.ts`) and take `shop` first.
Money is stored as integers (percentage as basis points, fixed amounts in minor units of the shop currency).

SQLite is **not** supported in production (single file, single instance, no concurrent writers). Production uses
PostgreSQL via the generated `prisma/postgres/schema.prisma` (only the `datasource` differs; a test fails if the
models diverge) and the baseline in `prisma/postgres/migrations/0001_baseline`. Regenerate with
`node scripts/gen-postgres-schema.mjs`. After changing the SQLite schema, add a matching PostgreSQL migration:
`DATABASE_URL=… npx prisma migrate diff --from-migrations prisma/postgres/migrations --to-schema-datamodel prisma/postgres/schema.prisma --shadow-database-url …`.
The PostgreSQL baseline and `migrate deploy` have **not** been run against a real PostgreSQL server.
Details: [docs/deployment.md](docs/deployment.md).

## Known platform restrictions

- Function-based discounts: at most **25 active function discounts per store across all apps** (docs). The design
  uses one, and caps active bundles at 20 (see below).
- Custom-distribution apps can only use Functions on **Shopify Plus** stores; non-Plus stores need a public
  (App Store) app. Distribution cannot be changed after it is chosen.
- Function limits (docs): input ≤ 128 KB, output ≤ 20 KB, 11M instructions. Local `function run` measurements
  (TypeScript): 20 matching bundles cost ≈ 4.4M instructions at 10 cart lines, ≈ 7.0M at 30 lines and ≈ 19M at
  200 lines. Large carts can exceed the limit; a Rust implementation would be the mitigation. Each cart line costs
  ≈ 40K instructions on its own.
- Online Store 2.0 themes only. Headless storefronts are out of scope.
- Metafield value ≤ 256 KB; v1 enforces 64 KB and ≤ 20 active bundles, ≤ 10 components per bundle.
- The app proxy rate limiter is in-memory (per process).

## Dashboard sections, Orders, Suggestions and Analytics

- **Dashboard** also shows the newest 5 bundle orders and the top 3 suggested bundles (suggestions stream in after the page
  loads). Navigation is Dashboard, Bundles, Analytics, Diagnostics.
- **Orders** (`/app/orders`, opened from "View all"): every synced bundle order with its number, bundle, gross, discount,
  refunded amount, net revenue, live/historical, and an "Estimate" flag with the reason. Read-only.
- **Suggestions** (`/app/suggestions`): product pairs that were bought together in the last 60 days (newest 250 orders),
  minus pairs already in a live bundle, each with a "Create this bundle" link that opens a prefilled **draft**. It reads
  only which variants shared an order (no customer, price or address fields), describes past orders, and never forecasts.
- **Analytics** (`/app/analytics`): views, add-to-cart, orders, net revenue, discount and refund rates, a per-bundle funnel and
  a revenue-per-day chart. Storefront counts do not need order access; revenue figures say "unavailable" when it fails.
  Days are UTC; rates show "—" when there is nothing to divide by.
  Orders, Suggestions and revenue need the same order access. Status: [docs/acceptance-checklist.md](docs/acceptance-checklist.md), sections 10 and 11.

## Brand

Colours come from the logo; see [docs/brand/README.md](docs/brand/README.md) (palette, what is and is not branded, and the
app-icon upload step). Tokens: `app/bundles/brand.ts`.

## Unverified behavior

None of the following has been exercised against Shopify. Do not treat the integration as working until the
manual checklist is complete.

1. **Metafield namespace `$app:bundler`.** The app writes `{namespace: "$app:bundler", key: "function-configuration",
   type: "json"}` on `discountAutomaticAppCreate/Update` and the Function reads the same pair. This follows the docs'
   "Metafields for input queries" page, whose discount example uses `$app:my-function` for both the write and the read;
   the docs do not explain how `$app` resolves, and the Admin API reference examples use `default`. Whether it
   resolves identically for write and read is unconfirmed. The constant is `CONFIG_NAMESPACE` in
   `app/bundles/config.ts`; the Function's `.graphql` must carry the same string (`tests/namespaceSync.test.ts`
   guards this). Fallbacks to try if it fails: bare `$app`, or the explicit `app--<app-id>` namespace.
1a. **Revenue tracking (whole feature).** Implemented locally; checked against one real order (#1001, full bundle, no refund) after selecting
   protected customer data use for the dev store. Still unverified: refund-to-line mapping, cancellations, order edits,
   other currencies, webhook payloads, and every remaining question in [docs/revenue-validation-checklist.md](docs/revenue-validation-checklist.md) are unverified. See
   [docs/revenue-tracking.md](docs/revenue-tracking.md). Acceptance status of every feature:
   [docs/acceptance-checklist.md](docs/acceptance-checklist.md).
2. **Discount capacity.** Whether the shared discount counts as exactly one of the 25 slots, and the actual error at
   the limit.
3. **Stacking.** `combinesWith` is set to products=false, orders=false, shipping=true. Docs (`DiscountCombinesWith`):
   "By default, only one product discount applies per line"; applying several product discounts to one line needs a
   Plus plan and matching tags (`productDiscountsWithTagsOnSameCartLine`), which this app does not use. So another
   product discount on a bundle line will not stack with ours; which one wins is not stated and is untested. Discount
   functions run concurrently and do not see each other.
4. **`write_app_proxy`.** Requested because the docs require it; whether the CLI/deploy flow accepts it as configured
   is unverified.
5. **Admin GraphQL shapes.** All strings validate against the 2026-07 schema (toolkit validator), but schema validity
   is not runtime proof (e.g. accepted `metafields` input, `discountNode.metafield` read-back, update semantics).
6. **Function runtime.** Built and run locally against fixtures only. The wasm has never run in checkout.
7. **Webhook HMAC verification** is done by `@shopify/shopify-app-react-router`; our tests mock it.
8. **Distribution type** of the existing app (`client_id` in `shopify.app.toml`) is unknown.
9. **Theme block** rendering in the theme editor and storefront, and `/cart/add.js` behavior, are unverified;
   `shopify theme check` reports no offenses.
10. **Currency/Markets.** Fixed amounts are converted with `presentmentCurrencyRate`; untested live.
11. **PostgreSQL** migration application is unverified.

## Not implemented (by design)

Purchase/revenue/conversion analytics (no `read_orders`), fixed-price bundles, mix-and-match, volume tiers, BXGY,
scheduling, billing, App Store listing. The engine dispatches on `pricing.kind` and the config version so these can
be added without rewriting the core.

## Project layout

```
app/bundles/            domain: validation, repo, sync, Admin wrappers, engine adapters, diagnostics
app/routes/             admin UI, app proxy (app_proxy.*), webhooks.*
extensions/bundle-discount/     Shopify Function (TypeScript) + pure engine.ts
extensions/bundler-storefront/  theme app extension (blocks/bundle.liquid, assets/bundle.{js,css})
prisma/                 SQLite schema + migrations; postgres/ generated schema + baseline
tests/                  Vitest suites
docs/                   design spec, plan, deployment notes, manual test checklist
```
