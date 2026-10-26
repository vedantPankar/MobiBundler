# MobiBundler v1 Design

Date: 2026-10-21 (rev 3: spike evidence, shared-discount architecture)
Status: implemented locally WITHOUT live verification (owner decision 2026-10-21; S1/S2/S3 remain unverified, see README "Unverified behavior"); approved with requirements; plan in `docs/superpowers/plans/2026-10-21-bundler-v1-plan.md`

## 1. Goal
Embedded Shopify bundler on the existing React Router 7 + Prisma template. v1 ships one complete flow: **fixed-product bundle with percentage or fixed-amount-off discount**, delivered by one shared Discount Function per shop, with a strategy interface that later admits fixed-price bundles and the other bundle types without rewriting the core.

## 2. Repo facts (inspected)
- JS (`.jsx`/`.js`), RR 7.18, `@shopify/shopify-app-react-router` 1.2, `shopify-api` 13.1.0 (newest `ApiVersion` enum is `July26`), Prisma 6 + SQLite (`prisma/dev.sqlite`, one migration, `Session` table), no git commits yet.
- `app/shopify.server.js`: `apiVersion: July26`, `AppDistribution.AppStore`, expiring offline tokens.
- `tsconfig.json`: `strict`, `allowJs`, includes `**/*.ts(x)`. No config change needed for TypeScript.
- `shopify.app.toml`: scopes `write_products,write_metaobjects,write_metaobject_definitions`; webhooks `api_version="2027-01"`; `application_url`/redirects are `https://example.com` placeholders (managed by `automatically_update_urls_on_dev`).
- `extensions/bundler-storefront`: theme extension, star-rating scaffold. No Rust toolchain installed.

## 3. Spike evidence

Legend: **DOC** = verified in official Shopify docs (searched 2026-10-21). **LIVE** = must be run in a dev store; *not executed yet*, no dev store session was available to the agent. Live spikes are Task 0 of the plan and gate the later tasks.

### S1. Discount capacity: how many configurations can we support?
- **DOC:** "You can activate a maximum of 25 discount functions on each store. All discount functions run concurrently, and have no knowledge of each other." (Discount Function API reference, identical in 2026-01 through 2027-01.) Changelog 2024-11-21: limit for automatic app discounts raised from 5 to 25.
- **Consequence:** the cap is **per store across all apps**, not per app. One discount per bundle could use up to the entire budget and would collide with the merchant's other function-based discounts. At 25 it cannot scale, and may fail much sooner on a store that already runs other discount apps.
- **Decision: one shared automatic app discount per shop** ("MobiBundler bundles") whose metafield carries every active bundle. It consumes **1 of 25** slots regardless of bundle count.
- **Rejected:** discount-per-bundle (cap), code discounts (shopper friction).
- **Limits of the shared approach (DOC):** metafield value ≤ 256 KB; Function input ≤ 128 kB, output ≤ 20 kB, 11 M instructions for ≤200 lines (JS is interpreted and costs more). **Mitigation:** v1 enforces a serialized-config budget of 64 KB and ≤ 10 components per bundle at save time (reject with a clear error), and an instruction-budget test.
- **LIVE S1 (confirms the plan, does not change it):** (a) our shared discount activates and runs; (b) record the actual error when a 26th function discount is activated; (c) confirm our shared discount counts as exactly 1.

### S2. Metafield namespace and access
- **DOC (read):** Function input `discount.metafield(namespace: "$app", key: "function-configuration") { jsonValue }`. `$app` is the app-reserved namespace in GraphQL (resolved per app); `app` in TOML.
- **DOC (write):** `discountAutomaticAppCreate/Update` accept `metafields: [{namespace, key, type, value}]`. The reference examples use namespace `default`, which is **not** the namespace they read with, so the docs do not show a verified `$app` write.
- **Status: UNVERIFIED.** Plan assumes `$app` for both. **LIVE S2:** create with `$app`/`function-configuration` type `json`, read back via Admin API `discountNode.metafield(namespace:"$app", key:"function-configuration")`, and run a Function build against it in the dev store. **Fallback if `$app` does not resolve on write:** write with an explicit app-reserved namespace string returned by Admin (`app--<app-id>`), or use `$app:bundler` and read the same; the namespace is a single constant (`CONFIG_NAMESPACE`) in one module plus the Function's input query. Whatever works is recorded in section 3 after Task 0.

### S3. Stacking
- **DOC:** `combinesWith {productDiscounts, orderDiscounts, shippingDiscounts}` is set on the discount node; discount functions run concurrently, unaware of each other; outputs combine "in alignment with the combination and stacking rules set on the discount node".
- **Not documented:** behaviour when two product discounts hit the same line.
- **Design that avoids relying on it for our own bundles:** all bundles live in **one** function run. The engine allocates cart units to bundles itself: each unit belongs to at most one bundle; overlapping bundles, duplicate products, multiple sets, and quantity changes are resolved deterministically inside the engine and unit-tested with fixtures. Shopify combination rules only matter against **other** discounts.
- **Conservative defaults:** `combinesWith = {productDiscounts:false, orderDiscounts:false, shippingDiscounts:true}`. Merchant-facing setting is out of v1.
- **LIVE S3 (manual):** our discount alongside a native percentage, a free-shipping discount, and another app's product discount; confirm the result and record it.

### S4. Distribution
- **DOC:** "Stores on any plan can use public apps that are distributed through the Shopify App Store and contain functions. Only stores on a Shopify Plus plan can use custom apps that contain Shopify Function APIs." Custom distribution: one store, stores in one Plus organization, or development stores. **Distribution cannot be changed after selection.** Public requires Shopify approval.
- **Targets (separate, never conflated):**
  | | Public (App Store) | Custom |
  |---|---|---|
  | Production path | **Yes (intended)** | No: only a single Plus store / Plus org |
  | Functions on non-Plus | Yes | **No** |
  | Dev-store testing | Yes | Yes |
  | Review | Required (incl. mandatory privacy webhooks) | None |
- **Decision:** design for public distribution from the start. The code already uses `AppDistribution.AppStore`. Implications: mandatory compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) are in v1 (we store no customer data, handlers acknowledge and purge shop data on `shop/redact`); billing and app listing are later work; the distribution type of the existing Dev Dashboard app (`client_id 9eecbb46…`) is **unknown to the agent**: the owner must confirm it is public, or create a new public app and `shopify app config link` to it **before** the first deploy. Do not deploy until confirmed.
- **Never claimed:** that the Function runs for a custom-distributed install on a non-Plus store.

### S5. Time/scheduling (found while researching)
- **DOC:** Function input includes `shop.localTime` (store-timezone current time). So a Function *can* read the date via input; the earlier "Functions can't know the time" note applied to the runtime, not to input.
- **Decision:** scheduling is **out of v1** (no `startsAt/endsAt` columns). Adding it later is additive (config field + `localTime` query). Draft/active/paused/archived is v1.

### S6. Versions
- **DOC:** `2026-10` latest stable; `2027-01` is a release candidate. The library enum ends at `July26`. **v1 uses `2026-07` everywhere** (app, codegen, webhooks, Function) and moves to `2026-10` once `shopify-api` supports it.

## 4. Architecture

### 4.1 Layout (new code TypeScript; template `.jsx` untouched)
```
extensions/bundle-discount/            # Function, typescript flavor, API 2026-07
  src/engine.ts                        # PURE allocation engine, no Shopify imports (single source of truth)
  src/cart_lines_discounts_generate_run.ts / .graphql
app/bundles/
  types.ts  config.ts                  # BundleStrategy, SharedConfig, CONFIG_NAMESPACE/KEY, size budget
  validation.ts                        # Zod schemas
  strategies/{index,fixed}.ts          # registry; fixed implemented
  repo.server.ts                       # ONLY module touching bundle tables; shop is first arg
  sync.server.ts                       # builds shared config, upserts the shared discount
  shopifyDiscount.server.ts            # Admin GraphQL wrappers
  events.server.ts                     # view/add_to_cart ingestion
app/routes/app.bundles._index.tsx, app.bundles.new.tsx, app.bundles.$id.tsx, app.diagnostics.tsx
app/routes/app_proxy.bundles.tsx, app_proxy.events.tsx   # app proxy (url=/app_proxy, storefront path /apps/mobi-bundler)
app/routes/webhooks.products.delete.tsx, webhooks.compliance.tsx   # compliance_topics: customers/data_request, customers/redact, shop/redact
extensions/bundler-storefront/blocks/bundle.liquid  # replaces star_rating scaffold
```
The app imports `engine.ts` by relative path for the live preview, so preview and checkout math share one implementation (no parity drift). Existing `app.jsx` (nav) and `app._index.jsx` (dashboard) are edited, not rewritten.

### 4.2 Strategy interface (future-proof)
```ts
type PricingModel =
  | { kind: "percentage"; basisPoints: number }          // v1
  | { kind: "fixed_amount_off"; amountMinor: number }    // v1
  // future, additive: | { kind: "fixed_price"; totalMinor: number }
interface BundleStrategy<C> {
  key: string;
  validate(input: unknown): C;
  toSharedEntry(bundle: StoredBundle): SharedBundleEntry;  // what goes in the metafield
}
```
The metafield carries `{v:1, bundles:[{id,pricing,items}]}`. The Function dispatches on `pricing.kind` through a handler map and **skips unknown kinds**, so a newer app version can write kinds an older deployed Function ignores without crashing checkout.

### 4.3 Database (Prisma; `Session` untouched)
Portable by design: no Prisma enums, no `Decimal`/`Json`, money as integers (percentage as basis points, fixed amount as minor units), strings validated by Zod, `DateTime` and `Int` only.
```
model Bundle {
  id            String   @id @default(cuid())
  shop          String
  name          String
  description   String?
  type          String   @default("fixed")      // strategy key
  status        String   @default("draft")      // draft|active|paused|archived
  pricingKind   String                          // percentage|fixed_amount_off
  pricingValue  Int                             // basis points | minor units
  currencyCode  String
  syncStatus    String   @default("pending")    // pending|synced|error
  syncError     String?
  version       Int      @default(1)            // optimistic concurrency
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  items         BundleItem[]
  @@unique([shop, name])
  @@index([shop, status])
  @@index([shop, updatedAt])
}
model BundleItem {
  id        String @id @default(cuid())
  bundleId  String
  shop      String
  productId String
  variantId String
  quantity  Int    @default(1)
  position  Int    @default(0)
  bundle    Bundle @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  @@unique([bundleId, variantId])
  @@index([shop, variantId])
}
model BundleEvent {
  id        String   @id @default(cuid())
  shop      String
  bundleId  String
  type      String                               // view|add_to_cart
  dedupeKey String
  createdAt DateTime @default(now())
  @@unique([shop, dedupeKey])
  @@index([shop, bundleId, type, createdAt])
}
model ShopDiscount {                              // 1 row per shop: the shared discount
  shop              String   @id
  shopifyDiscountId String?
  configHash        String?                       // skip no-op writes (idempotency)
  syncedAt          DateTime?
}
```
`shop` is on every table; every query includes it (4.5).

**SQLite dev / PostgreSQL production**
- Local: keep `provider = "sqlite"` in `prisma/schema.prisma`. **Never run `prisma migrate reset` or `db push --force-reset`.** Before the first migration copy `prisma/dev.sqlite` to `prisma/dev.sqlite.bak` (gitignored). Migrations are additive (`migrate dev --name add_bundles`).
- Production: Prisma fixes the provider per schema file. `prisma/postgres/schema.prisma` is **generated** from `schema.prisma` by `scripts/gen-postgres-schema.mjs` (only the `datasource` block differs; `url = env("DATABASE_URL")`). A test fails if the model blocks diverge. Postgres migrations live in `prisma/postgres/migrations/`, baseline created once from an empty Postgres with `prisma migrate diff --from-empty --to-schema-datamodel prisma/postgres/schema.prisma --script`. Deploy: `DATABASE_URL=… prisma migrate deploy --schema prisma/postgres/schema.prisma`. Existing sessions are not migrated automatically; production starts clean (merchants re-auth via token exchange).
- Multi-instance hosting requires Postgres; SQLite is not supported in production.

### 4.4 Fixed-bundle workflow
1. **Create (admin):** `/app/bundles/new` collects name, description, status, discount (percentage % or fixed amount); picker searches Admin GraphQL `products(query:)` for title/image/variants/price/inventory. A bundle needs ≥ 2 distinct variants (quantity ≥ 1), ≤ 10 components. The server **re-fetches every variantId** from Shopify with the session's Admin client and rejects any it cannot find (never trusts form data). Currency comes from `shop.currencyCode`.
2. **Save:** one transaction writes `Bundle` + `BundleItem[]`; `shop` comes only from the session.
3. **Sync:** `sync.server.ts` reads all `active` bundles for the shop, builds the shared config, rejects over the 64 KB budget, hashes it, and if the hash differs upserts the **single** discount: `discountAutomaticAppCreate` first time, `discountAutomaticAppUpdate` afterwards (ID in `ShopDiscount`). Failure sets each affected bundle `syncStatus=error` with a message; "Retry sync" is idempotent. Zero active bundles ⇒ discount deactivated (not deleted).
4. **Render:** `bundler-storefront/blocks/bundle.liquid` takes a bundle ID setting, fetches `/apps/mobi-bundler/bundles?ids=…` (app proxy, signature verified) for display data (names, images, quantities, display prices, discounted total from the shared engine). Prices shown are informational.
5. **Add to cart:** the block posts `items:[{id, quantity}]` to `/cart/add.js` with optional line property `_mobi_bundle` (**grouping/analytics only**). Variant IDs are numeric storefront IDs mapped server-side.
6. **Discount:** Shopify runs the Function; it reads the shared metafield and `engine.allocate()` decides discounts purely from cart contents vs. the server-written config. Client prices, `_mobi_bundle` and submitted bundle IDs are ignored. A shopper who assembles the same variants by hand gets the same discount (bundle = composition), by design.

**Engine rules (`engine.ts`):** per-variant unit pool across lines; bundles ordered by descending estimated saving per set then id (deterministic); `sets = min(floor(available/required))`; consumed units are removed from the pool (no double discounting, extra units stay full price); percentage total = `floor(subtotal × bps / 10000)`; fixed = `min(amountMinor × sets, subtotal)`; the total is distributed across consumed chunks pro rata by chunk subtotal with largest-remainder; outputs one candidate per chunk as `fixedAmount` (`appliesToEachItem:false`). Fixed amounts are converted to presentment currency with `presentmentCurrencyRate`; currency exponent table covers 0/3-decimal currencies, default 2.

### 4.5 Authorization, isolation, errors, idempotency
- Admin routes: `authenticate.admin(request)`; `shop` from session only, never params/body.
- `repo.server.ts` exports functions taking `shop` first. No `findUnique({id})` without shop anywhere else (ESLint `no-restricted-syntax` + a test that greps for `prisma.bundle` outside the repo). Cross-shop ids return 404.
- App proxy: `authenticate.public.appProxy`; GET reads active bundles of the verifying shop only; events POST rate-limited, dedupe by `dedupeKey`, no PII.
- Webhooks: `authenticate.webhook` (HMAC). `app/uninstalled` and `shop/redact` delete all rows for the shop; `products/delete` pauses affected active bundles with an explanatory message (never deletes them); missing variants are otherwise detected live in Diagnostics; handlers idempotent (updateMany/deleteMany, 200 on replay). `customers/*` acknowledge (no customer data stored).
- Errors: Zod ⇒ 422 with field errors; Shopify `userErrors` surfaced and stored in `syncError`; logger allowlists `{shop, bundleId, route, requestId}`; no tokens or customer data in logs.

### 4.6 Analytics (v1)
Real events only: `view` and `add_to_cart` through the app proxy. Dashboard shows counts and "Purchases/revenue: not tracked". **Purchase attribution is not a v1 dependency.** Future requirements (not implemented, not claimed): subscribe `orders/paid`, scope `read_orders` (last 60 days; `read_all_orders` needs approval), protected-customer-data review as applicable, match by discount application/line property; approval requirements are to be re-verified when this is started. Revenue and conversion are never shown until verified.

## 5. Required changes
- **Extensions:** keep `bundler-storefront` (replace scaffold files); add `extensions/bundle-discount` (`shopify app generate extension --template discount --flavor typescript --name bundle-discount`, API `2026-07`, target `cart.lines.discounts.generate.run`, delivery target removed).
- **Scopes:** `read_products,write_discounts` (+ `write_app_proxy` only if deploy demands it, recorded after Task 0). Remove `write_metaobjects,write_metaobject_definitions` and the demo metafield/metaobject blocks. No `read_orders` in v1.
- **Config:** webhooks `api_version` → `2026-07`; add `[app_proxy]`; subscriptions: `products/delete`, compliance topics.
- **Migrations:** `add_bundles` (Bundle, BundleItem, BundleEvent, ShopDiscount), additive; Postgres baseline per 4.3.
- **Dependencies:** `zod`, `vitest`. No UI library change (Polaris web components).
- **Not touched:** `Session` model/data, `app/shopify.server.js` auth setup (except exporting nothing new), `webhooks.app.*` (uninstall extended additively).

## 6. Tests
Automated (`vitest`; gate = `npm run typecheck && npm test && npm run build`, plus `shopify app function build` in the Function dir):
- **Engine:** percentage/fixed; rounding and remainder; extra units; multiple sets; **overlapping bundles; duplicate product on several lines; two bundles in one cart; quantity increase/decrease/removal; bundle with quantity>1 components**; fixed clamp; unknown pricing kind skipped; 0/3-decimal currencies; presentment rate; determinism (shuffled lines → same result); instruction budget with 200 lines.
- **Function:** fixture input/output JSON run via `shopify app function run`.
- **Validation:** Zod rules; budget overflow; component cap.
- **Authorization/isolation:** repo calls with the other shop return nothing; route actions with shop B session cannot read/update A's bundle; proxy bad signature rejected; webhook bad HMAC rejected; no `prisma.bundle*` outside repo.
- **Idempotency:** double sync (same hash ⇒ no mutation), replayed webhook, duplicate event key.
- **Inventory/variant edge cases:** deleted variant flags warning; out-of-stock displayed, not blocked.
- **DB portability:** generated Postgres schema models equal SQLite models.

## 7. Manual dev-store checklist (cannot be verified by the agent)
0. Confirm app distribution = public (S4) before any deploy; `shopify app dev` only against a dev store.
1. S1/S2/S3 live spikes (plan Task 0) and record results in section 3.
2. Install, scope consent; create bundle → one shared discount appears in Discounts; second bundle does **not** create another.
3. Theme block renders on an OS 2.0 theme; add-to-cart adds all components.
4. Checkout: discount applies; extra units full price; removing a component removes it; two sets; two overlapping bundles; same product on two lines.
5. Combination with native %, free shipping, another app's product discount.
6. Pause/archive removes discount; zero active bundles deactivates it.
7. Multi-currency/Markets pricing for percentage and fixed bundles.
8. App proxy bad signature, event ingestion, uninstall cleanup, `shop/redact`.
9. Non-Plus dev store with public-distribution app (expected to run); document that a custom-distribution install on non-Plus will not.

## 8. Remaining risks
1. `$app` write namespace unverified (S2) until Task 0.
2. Stacking vs. other apps' discounts undocumented (S3); manual.
3. Existing app's distribution type unknown and immutable once chosen (S4).
4. TypeScript Function CPU on large carts; Rust swap needs a toolchain.
5. 64 KB / 10-component budgets are conservative guesses; tune with the instruction test.
6. SQLite not for production; Postgres baseline and hosting are owner work.
7. Merchant can manually deactivate the shared discount in Admin; diagnostics detect and offer re-sync.
8. Library lags API: staying on `2026-07`.
9. Online Store 2.0 only; headless out of scope.

## 9. Out of v1
Fixed-price bundles (interface-ready), mix-and-match, volume tiers, BXGY, FBT, tiered groups, `productBundleCreate`, Cart Transform, scheduling, purchase/revenue analytics, merchant-configurable combination settings, billing, App Store listing.
