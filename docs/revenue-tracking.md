# Revenue tracking

**Status: implemented locally; checked against ONE real order (#1001: a full bundle, no refund).** Order access works on
the dev store after selecting protected customer data use (Level 1, no customer fields). Most tests use synthetic
orders; `tests/realOrder1001.test.ts` uses the real one. Refunds, cancellations, edits, other currencies and webhooks
have not been seen in real data. Open questions: [revenue-validation-checklist.md](revenue-validation-checklist.md).

## Definitions

- **Gross bundle sales**: list price of the bundle units sold, before the bundle discount and before refunds.
- **Discounts given**: bundle discount on those units.
- **Net sold** = gross - discounts.
- **Net bundle revenue** = net sold minus the value of refunded units and of cancelled orders. Excludes tax and
  shipping. This is the headline number.
- **Orders**: orders with at least one bundle unit, not cancelled. **Average bundle order** = net revenue / orders.
- All money is integer minor units in the shop currency (`shopMoney`), formatted only for display.

## How it works

1. **Collection (pull):** `syncOrders` reads orders updated since the last cursor through Admin GraphQL
   (`ordersSource.server.ts`). The dashboard runs it when data is older than 5 minutes, and "Sync orders now" runs
   it on demand. Webhooks can later feed `ingestOrder` unchanged.
2. **Normalizing:** `orderNormalizer.ts` is the only code that knows Shopify's order shape.
3. **Attribution:** `attribution.ts` replays the checkout engine (`allocateDetailed`) over the order's lines with the
   shop's current non-draft bundles. It does not use the `_mobi_bundle` line property, so individually added items
   work, unrelated items in a mixed cart are ignored, and each unit belongs to at most one bundle.
4. **Reconciliation:** the replayed discount per line is compared with the discount Shopify recorded for our
   discount. Orders record it as an `AutomaticDiscountApplication` titled with the Function's message,
   `BUNDLE_DISCOUNT_MESSAGE` ("Bundle discount"), not the discount's admin title (seen on real order #1001). A mismatch, truncated data or an unreadable
   line marks the order **unreconciled**; the dashboard says its numbers are estimates.
5. **Storage:** `OrderRecord` (one per order: lines, refunds, frozen attribution, fingerprint) and
   `BundleOrderRevenue` (one per order x bundle, replaced atomically on every change). No customer data.

## Rules that keep it correct

- **Idempotent:** an unchanged reconciled order is skipped by fingerprint; any change replaces the order's rows in one
  transaction. Re-running a sync, a backfill or overlapping pages cannot double count.
- **Refunds** are keyed by refund id and capped at the units sold, so repeated or over-reported refunds cannot deduct
  twice. A refunded unit is assumed to be a bundle unit first (never overstates revenue). A refund returns the unit's
  exact gross and its share of the discount (floor(D/Q) per unit, leftover cents to the first units), so refunding
  every unit returns exactly D.
- **Cancellation** zeroes the order; refunds on a cancelled order are ignored.
- **Amount-only refunds** (no order lines named, which also covers shipping and tax) are not deducted from bundle
  revenue; they are shown separately on the dashboard.
- **Bundle edits after checkout:** a reconciled order keeps its stored attribution, so history is never rewritten.
  Unreconciled orders are re-attributed with the current bundles each time they are seen.
- **Order edits:** if an order's lines change, attribution is recomputed. A line whose current quantity differs from
  its purchased quantity is noted; revenue still uses purchased quantities minus refunds (**unverified**).
- **Historical vs live:** the first sync stamps `trackingStartedAt` and reads the last 60 days. Orders placed before
  it are `backfill` ("historical"), later ones are `live`; the dashboard shows both counts.
- **Estimates are re-checked:** the sync cursor only moves forward, so each sync also re-reads up to 25 orders last
  seen as estimates; they recover once the config or the code is corrected.
- **Failures:** a failing order is logged and counted; the sync cursor does not advance past it, so it is retried. A
  Shopify access refusal is stored and shown on the dashboard as an actionable banner, and is not retried on every
  page view.

## Dashboard states (zero is not the same as unavailable)

`revenueViewState` decides what the dashboard may claim:

| State | When | Shown |
|-------|------|-------|
| unsynced | no sync has been attempted | "Revenue has not been synced yet" |
| unavailable | no successful sync and the last attempt failed | "Revenue is unavailable" plus the reason; **no numbers** |
| empty | a sync succeeded, no bundle orders in the period | an explicit zero |
| data | bundle orders exist | totals, per-bundle table, caveats |

Sync failures carry a code: `ACCESS_NOT_APPROVED` (Shopify has not approved Order access: critical banner explaining
revenue is unavailable, not zero), `ACCESS_DENIED` (missing `read_orders`), `FAILED` (anything else, retried). A failure
after an earlier success keeps the earlier data on screen with a banner. Money is never added across currencies: the
dashboard shows the shop currency and says how many orders in other currencies were left out.

## Event processing

- **Sync** (dashboard load when data is >5 minutes old, and "Sync orders now"): reads orders updated since the cursor.
  Oldest-update-first, so hitting the page limit (`partial`) is safe: the next run continues.
- **Webhook route** (`webhooks.orders.tsx`, topics `orders/paid`, `orders/cancelled`, `refunds/create`): verified by
  `authenticate.webhook`, takes only an order id, re-reads the order and runs the same ingestion. Duplicate, late or
  reordered deliveries converge on Shopify's current state. A transient failure returns 500 so Shopify retries; an
  unusable id or uninstalled shop returns 200. **Not subscribed**: the subscription is commented out in
  `shopify.app.toml` until protected customer data access is approved.
- **Concurrency:** a per-shop lock serialises syncs and webhook ingestion in one process, and a unique-constraint
  conflict between processes is retried once as an update.
- **Currencies:** an order is always attributed in the shop currency Shopify reports. A bundle priced in a different
  currency than the order is flagged unreconciled instead of being trusted.

## Sets after refunds

`BundleRevenue.sets` is the number of complete sets still intact: units left per variant after refunds, divided by what
one set needs. Refunding one component breaks one set; refunding both components of the same set also breaks only one
set. A cancelled order has none. Attributions stored without item details (older records) keep the purchased count.

## Security and data minimisation

- No customer data is requested or stored: the order query has no customer, address, email or phone field, and the
  stored lines hold only variant ids, quantities and prices. Logs carry order ids and error names only.
- Webhook signatures are verified before any handling; the sync and the dashboard action require an authenticated
  admin session. Dev capture routes fail closed (only `NODE_ENV=development`), are read-only and write sanitized,
  git-ignored files.
- Uninstall and `shop/redact` delete all revenue tables for the shop (tested).

## Known limits and unverified behavior

- Verified on one real order: the query, line/price/discount shape and how our discount is labelled. Unverified:
  refund-to-line mapping, cancellations, order edits, other currencies, webhook field names `id` / `order_id`. A
  merchant's own automatic discount titled "Bundle discount" would be misread as ours (no discount id is returned). See [revenue-validation-checklist.md](revenue-validation-checklist.md).
- Percentage discounts are taken on the pooled subtotal of all sets, which can differ by a cent from twice a single
  set (matches checkout).
- Only 60 days are readable without extra Shopify approval (`read_all_orders`).
- Dashboard totals are aggregated in application code over the selected period; very large stores would need
  database-side aggregation.
- Amount-only refunds (including shipping/tax) are shown separately and not deducted from bundle revenue.
- Order edits: purchased quantities minus refunds are used; edits are noted, not modelled (unverified).
- A refunded unit is assumed to be a bundle unit first (conservative).
- No per-bundle revenue panel on the bundle edit page yet; the dashboard table is the only per-bundle view.
