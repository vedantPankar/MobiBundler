# Consolidated end-to-end test package (one session)

Everything here is **unverified** until you run it. Run only on the development store you own
(`mobibundler.myshopify.com`). Do not use `shopify app deploy` for this checklist. Record Result/Notes per row.
Rows tagged **[DEV]** need a development store; **[DIST]** depends on the app's distribution type;
**[THROWAWAY]** should be done on a throwaway store only.

## 1. Environment and setup

| # | Step | Expected | Result |
|---|---|---|---|
| 1.1 | Node `>=20.19 <22` or `>=22.12`; `shopify version` (CLI 3.x) | OK | |
| 1.2 | `git status` clean except your own work; no `.env` tracked | | |
| 1.3 | `npm install` | No errors | |
| 1.4 | Env vars (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`) are supplied by `shopify app dev`; `DATABASE_URL` only for Postgres | Nothing real committed | |
| 1.5 | Offline gate: `npm test && npm run typecheck && npm run lint && npm run build` | All pass (118 tests at hand-off) | |

## 2. Database

| # | Step | Expected | Result |
|---|---|---|---|
| 2.1 | `cp prisma/dev.sqlite prisma/dev.sqlite.bak` | Backup (git-ignored) | |
| 2.2 | `npx prisma generate && npx prisma migrate deploy` | 3 migrations applied/up to date | |
| 2.3 | `sqlite3 prisma/dev.sqlite "select count(*) from Session;"` | Same as before | |
| 2.4 | Never `prisma migrate reset` | | |

## 3. Shopify CLI and dev-store setup **[DEV] [DIST]**

| # | Step | Expected | Result |
|---|---|---|---|
| 3.1 | `shopify auth logout/login` as needed; `shopify app config link` only if you must change app | `client_id` in `shopify.app.toml` is the intended app | |
| 3.2 | Confirm distribution of the app in the Dev Dashboard | **Public** for production; record actual. Custom = Functions run only on Plus | |
| 3.3 | `npm run dev` and choose `mobibundler.myshopify.com` | Tunnel up, app installs. This creates a dev app version on that store | |
| 3.4 | Consent screen scopes | `read_products, write_discounts, write_app_proxy` | |
| 3.5 | If dev reports a scope or `[app_proxy]` problem | Record the exact message (resolves the `write_app_proxy` question) | |
| 3.6 | Store has an OS 2.0 theme and ≥ 4 in-stock products (one with 2+ variants) | | |

## 4. Admin auth and navigation **[DEV]**

| # | Step | Expected | Result |
|---|---|---|---|
| 4.1 | Open the app from Shopify admin | Embedded, no re-login loop | |
| 4.2 | Nav: Dashboard / Bundles / Diagnostics | All load; no console errors | |
| 4.3 | Dashboard on a fresh install | "Create your first bundle", Performance says no data / purchases not tracked | |

## 5. Bundle creation and persistence **[DEV]**

| # | Step | Expected | Result |
|---|---|---|---|
| 5.1 | Create a **draft** 10% bundle with 2 variants | Saved; **no** discount appears in Shopify admin → Discounts | |
| 5.2 | Reload, reopen | All fields persisted | |
| 5.3 | Duplicate, edit name/items, pause, archive, bulk actions | Statuses update; duplicate is a draft "(copy)" | |
| 5.4 | Duplicate name; 1 variant; 11 variants; 0% / 101% | Inline validation errors | |
| 5.5 | Open `/app/bundles/<random id>` | 404 | |

## 6. Product and variant selection **[DEV]**

| # | Step | Expected | Result |
|---|---|---|---|
| 6.1 | Search by title; empty search | Active products listed with price/stock | |
| 6.2 | Multi-variant product: add two variants | Both selectable | |
| 6.3 | Out-of-stock variant | Warning badge, still addable | |
| 6.4 | Live preview vs. manual math | Matches (preview uses the same engine as the Function) | |
| 6.5 | Delete a product in a draft bundle, reopen the bundle | "Unavailable" badge, banner | |

## 7. Metafield synchronization **[DEV]** (resolves S1/S2)

| # | Step | Expected | Result |
|---|---|---|---|
| 7.1 | Set the bundle **active** | Exactly one discount "MobiBundler bundles" appears | |
| 7.2 | Create a second active bundle | Still one discount; config now has two bundles | |
| 7.3 | Read the metafield via Admin API (`discountNode.metafield(namespace:"$app:bundler", key:"function-configuration")`) | JSON `{v:1,bundles:[…]}` | |
| 7.4 | If 7.1/7.3 fail with a namespace error | Record it; try bare `$app`, then `app--<app-id>`. Change `CONFIG_NAMESPACE` **and** the Function `.graphql` together (`tests/namespaceSync.test.ts` enforces equality) | |
| 7.5 | Re-save with no change | No Shopify write (hash unchanged) | |
| 7.6 | Pause all bundles | Discount deactivated; reactivating reactivates it | |
| 7.7 | **[THROWAWAY]** Reach the 25 function-discount limit and try one more | Record the exact error; confirm ours counts as 1 | |
| 7.8 | Force a failure (e.g. revoke `write_discounts`, or rename the Function handle) | Bundle shows "Sync failed"; Retry/Re-sync works after fixing | |

## 8. Theme extension **[DEV]**

| # | Step | Expected | Result |
|---|---|---|---|
| 8.1 | Theme editor → product template → Add block → Apps → "Bundle" | Block available | |
| 8.2 | Paste the bundle id; accent colour | Renders in the editor (name, items, prices, savings) | |
| 8.3 | Storefront product page | Same; savings line follows the "Show savings" setting; custom button label shown | |
| 8.4 | Empty / draft / archived / foreign id | Hidden on storefront; message in editor | |
| 8.5 | Keyboard: tab to button, Enter; screen reader hears status; 320 px width | Usable | |
| 8.6 | Unsigned request to the proxy path on the app URL | Rejected | |
| 8.7 | Dashboard Performance after browsing | Views increment once per session/hour | |

## 9. Add to cart **[DEV]**

| # | Step | Expected | Result |
|---|---|---|---|
| 9.1 | Click "Add bundle to cart" | All components with correct quantities; lands on `/cart` | |
| 9.2 | Sold-out component | Disabled/badge, or 422 → sold-out message, button re-enabled | |
| 9.3 | Dev-tools: alter the request body to add a price | Ignored by Shopify; the discount does not change (step 10.7) | |

## 10. Discount at checkout **[DEV] [DIST]**

| # | Step | Expected | Result |
|---|---|---|---|
| 10.1 | Cart with exactly the bundle | Percentage/fixed discount applied at checkout | |
| 10.2 | Partial bundle (a component missing) | **No** bundle discount | |
| 10.3 | Extra units (3×A, 1×B) | One set discounted; extras full price | |
| 10.4 | Two sets (2×A, 2×B); quantity edits in cart | Recalculates | |
| 10.5 | Same variant on two lines | Pooled; discounted once per set | |
| 10.6 | Two overlapping bundles sharing a variant | No unit discounted twice; higher saving wins | |
| 10.7 | Forge `_mobi_bundle` property or a price | No effect | |
| 10.8 | Fixed amount larger than the subtotal | Clamped to subtotal | |
| 10.9 | Markets / presentment currency ≠ shop currency | Fixed amount converted by `presentmentCurrencyRate`; record | |
| 10.10 | Cart of 30–50 lines with several bundles | No Function error (local estimate ≈ 7M instr at 30 lines/20 bundles; limit 11M) | |
| 10.11 | Public-distribution install on a non-Plus dev store | Function runs | |
| 10.12 | If custom distribution on a non-Plus store | Functions do **not** run (expected platform restriction) | |

## 11. Stacking **[DEV]**

| # | Step | Expected | Result |
|---|---|---|---|
| 11.1 | Bundle + native percentage product discount on the same line | Docs: one product discount per line by default. Record which applies | |
| 11.2 | Bundle + free-shipping discount | Both apply (`shippingDiscounts: true`) | |
| 11.3 | Bundle + another app's product discount | Record behavior | |
| 11.4 | Bundle + order discount | Not combined (`orderDiscounts: false`); record | |

## 12. Webhooks and error handling **[DEV]**

| # | Step | Expected | Result |
|---|---|---|---|
| 12.1 | Delete a product used by an active bundle | Bundle paused with a "deleted" explanation; discount re-synced | |
| 12.2 | `shopify app webhook trigger` for `shop/redact`, `customers/redact`, `customers/data_request` | 200; `shop/redact` purges the shop's data | |
| 12.3 | Webhook with a bad HMAC | 401 | |
| 12.4 | Replay a webhook | 200, no duplicate effect | |
| 12.5 | Uninstall the app | Sessions and bundle rows deleted | |
| 12.6 | Diagnostics: deactivate / delete the shared discount in Shopify admin; remove a variant | `DISCOUNT_INACTIVE` / `DISCOUNT_MISSING` / `VARIANT_MISSING`; "Re-sync now" repairs | |
| 12.7 | Stop the dev server while on the storefront | Block shows a friendly error, no console exceptions that break the page | |

## 13. Known limitations and expected results

- Functions need a public app, or a Plus store for custom distribution; distribution is immutable.
- Max 25 function discounts per store (all apps); we use 1. v1 caps active bundles at 20 and components at 10.
- Large carts may exceed the Function's 11M instruction limit (TypeScript); the mitigation is a Rust rewrite.
- Purchase, revenue and conversion analytics are not implemented.
- Storefront is Online Store 2.0 only. SQLite is dev-only; production needs PostgreSQL (`docs/deployment.md`).
- `application_url` / redirect URLs are placeholders until you deploy to a real host.
- Anything in the README's "Unverified behavior" list that fails here is a finding to fix, not a regression.
