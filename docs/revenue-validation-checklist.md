# Revenue tracking: real-payload validation checklist

Status: **one real order (#1001, a full bundle, no refunds) has been read; everything else below is still unverified.** Evidence for #1001 is in the section "Evidence from order #1001".  The attribution and refund model
(`app/bundles/attribution.ts`, tests in `tests/attribution.test.ts` and `tests/allocationReplay.test.ts`) is pure
logic over the checkout engine. This list says what real data must show before any database, ingestion, backfill or
dashboard work starts.

Blocked on: protected customer data access for the Order object (Level 1, no name/address/phone/email fields). All
captures go to the git-ignored `.captures/` folder, sanitized by `app/bundles/capture.server.ts`. Dev store only.

## Ground rules

- Field names in the "Needed" columns come from two places only: (a) fields already requested in
  `ORDER_FIELDS` in `capture.server.ts`, which has **never been executed** and is itself unverified, and (b) fields
  marked **UNVERIFIED: discover from payload**, meaning the real payload must be read to learn whether and under what
  name Shopify exposes them. Do not assume a field exists because it is listed here.
- A question is closed only by a saved capture file, cited by filename, that shows the behavior.
- One webhook event or GraphQL read per scenario; do not infer one scenario from another.

## Known model limitations (accepted, documented, tested)

1. **Sets after refunds** are now recounted from the units that remain (see revenue-tracking.md). Records stored
   without item details keep the purchased count.
2. **Pooled-subtotal rounding.** For percentage bundles the engine takes the percentage of the pooled subtotal of all
   sets, so two sets discount floor(2S x p), which can be 1 cent more than twice the single-set discount (35,499 vs
   2 x 17,749 cents for order #1001's items). This is how checkout actually prices them, so revenue follows it.
   Covered by `tests/attribution.test.ts` ("quantity 2 forms two sets").

## Questions

| # | Question | Event sequence to produce | Needed from the payload | Closes when |
|---|----------|---------------------------|--------------------------|-------------|
| 1 | Do an order line's quantity and price equal what the engine received at checkout? Shop or presentment currency? | Order with full bundle; then bundle + unrelated item | Per line: `id`, `quantity`, `variant.id`, `originalUnitPriceSet.shopMoney` and `.presentmentMoney` (in `ORDER_FIELDS`, unverified) | Replaying `attributeOrder` on the captured lines reproduces each line's recorded discount to the cent |
| 2 | How does the order identify our discount, and does each line's allocated amount equal the engine's output? | Same orders as #1 | `discountApplications` (`__typename`, `allocationMethod`, `targetSelection`, `targetType`, value, `title`) and per-line `discountAllocations` (in `ORDER_FIELDS`, unverified). **UNVERIFIED: whether a stable identifier other than the title exists** | One discount application is unambiguously ours, and per-line allocations match `allocate()` exactly |
| 3 | Do other discounts on the same lines change what counts as bundle revenue? | Bundle plus a discount code; bundle plus a second automatic discount | All `discountApplications` and every line's `discountAllocations` | We know whether to subtract non-bundle discounts, and whether stacking is possible at all (also an open item in the README) |
| 4 | How does a refund map to order lines: by line and quantity, by amount, or both? Are amount-only, tax and shipping refunds represented, and how? | (a) refund 1 unit with restock; (b) refund 1 unit without restock; (c) amount-only refund; (d) refund shipping only; (e) refund tax only | `refunds[]` and `refundLineItems` (`quantity`, `lineItem.id`, `subtotalSet`) are in `ORDER_FIELDS`, unverified. **UNVERIFIED: restock type/flag, shipping and tax refund lines, order adjustments, transaction amounts** | We can state, per refund kind, which fields move revenue and which are ignored |
| 5 | What do `refunds/create`, `orders/cancelled` and cancel-with-refund send, and how do they relate? | (a) refund only; (b) cancel only; (c) cancel with refund and restock | The webhook payloads (HMAC-verified captures) plus the GraphQL order afterwards. **UNVERIFIED: ids linking a refund to its order, events fired, order of delivery, `cancelledAt` timing** | Event sequence per scenario is written down, including whether cancelling also emits refund events |
| 6 | Can a refund event change contents under the same id? | Re-deliver or re-read the same refund after editing it, if Shopify allows; read it twice over time | Refund `id` plus full contents at two times. **UNVERIFIED: whether Shopify ever mutates a refund** | Either "immutable per id" is shown, or `revenueAfterAdjustments`' keying by `refundId` must change to a version/updated-at rule |
| 7 | Order edits after purchase (quantity changes, line removal, added items) | Edit quantity down, remove a bundle item, add an item | `lineItems[].quantity` vs `currentQuantity` (both in `ORDER_FIELDS`, unverified); **UNVERIFIED: edit events, whether a bundle's discount is recalculated or kept** | We know which quantity to replay (original or current) and whether the stored discount still reconciles |
| 8 | When a line is only partly in a bundle, which unit does a refund take? | Cart with 3 units of a bundle variant (1 in the bundle); refund 1 unit, then 3 | Refund line quantities and any per-unit discount detail on the refund. **UNVERIFIED: whether Shopify exposes which units were discounted** | Evidence for or against the current rule (refunds take bundle units first, which is conservative) |
| 9 | Bundle config changes between checkout and processing | Place order; edit the bundle (items, pricing); then read the order and replay | Order captured before and after the edit; our bundle row version at each time | Replay against the edited config disagrees with Shopify's recorded allocation: this shows how often reconciliation would fail and whether the config at purchase time must be stored |
| 10 | Non-shop currency | Store with a second market currency, order in it, bundle with percentage and with fixed-amount-off pricing | `currencyCode`, `presentmentCurrencyCode`, both money sets per line; the Function's `presentmentCurrencyRate` is read in the function input but **UNVERIFIED: how it relates to the order's amounts** | Replay in shop currency reproduces the recorded allocation within a stated tolerance, or we record presentment amounts as well |

## Preconditions to start validation

1. Protected customer data access approved for the Order object, and dev server restarted.
2. Capture route works: `GET /app/dev/capture-order?number=<n>` (also `/app/capture?order=<n>`, a second route with the
   same purpose; consolidate when the capture phase ends). Both are dev-only and read-only.
3. Orders for the scenarios above placed by the owner on the dev store only, with a bogus gateway.

## Out of scope until this list is reviewed

Database schema changes, historical backfill, webhook ingestion (including re-enabling the commented-out
subscriptions in `shopify.app.toml`), polling, and dashboard metrics.

## Evidence from order #1001 (2026-10-25, `tests/fixtures/order-1001.json`)

- **Q1 (quantities, prices, currency): answered for this order.** `lineItems.nodes[].quantity` and
  `originalUnitPriceSet.shopMoney` were 1 and "1025.0" / "749.95" in USD; `presentmentMoney` was identical, so the
  shop-vs-presentment difference is still unseen. `currentQuantity` equalled `quantity`.
- **Q2 (identifying our discount): answered.** Shopify records one `AutomaticDiscountApplication` per discounted
  line, titled **"Bundle discount"**, which is the message our Function sets on each candidate. It is NOT the
  discount's own title ("MobiBundler bundles"), and no discount id was returned, so recognition rests on the title.
  Any other automatic discount a merchant titles "Bundle discount" would be misread as ours. The per-line
  `discountAllocations` were 102.5 and 74.99, exactly what `allocate()` computes.
- Line property `_mobi_bundle` appeared on `customAttributes` as expected (not used for attribution).
- `refunds` is a list and was empty. Everything about refunds, cancellations, edits, other currencies, other
  discounts on the same lines, and webhooks is still unseen.
