# MobiBundler full-app manual test checklist

Status of every item (and its automated coverage) is tracked in [acceptance-checklist.md](acceptance-checklist.md).

Run on `mobibundler.myshopify.com` only, with a bogus/test gateway. Do not deploy. Record Result/Notes per row.
Items marked (U) exercise behavior that is **unverified** against Shopify.

## 0. Preconditions
- [ ] `npm run dev` starts without errors; migrations applied (`20261025000000`, `20261025010000`).
- [ ] Unit suites green: `npx vitest run` (app) and `cd extensions/bundle-discount && npx vitest run`.
- [ ] Protected customer data (Level 1, no customer fields) requested for the app (U: whether dev stores need review).

## 1. Bundles (existing features)
- [ ] Create a 2-product percentage bundle; it saves, shows in the list, Diagnostics is ALL_OK.
- [ ] Create a fixed-amount bundle; edit, duplicate, pause, activate, archive; statuses change as expected.
- [ ] Duplicate-name and shared-variant warnings behave.

## 2. Storefront block
- [ ] Block with empty Bundle ID shows the active bundle for a product that is in it (product pages only).
- [ ] A pasted Bundle ID overrides auto-detection.
- [ ] Product in no bundle: live storefront hides the block; theme editor shows "No active bundle includes this product."
- [ ] Mobile width: two-column grid, long names wrap, no horizontal scroll.
- [ ] "Add to theme" buttons (Dashboard, Bundles) open the theme editor with the block ready.

## 3. Cart and checkout discount
- [ ] Block's add-to-cart: all items in cart with "Bundle discount"; subtotal equals the block's price to the cent.
- [ ] Same items added one by one: same discount.
- [ ] Two overlapping bundles: each unit discounted once.
- [ ] Pause the bundle: discount disappears from a fresh cart. Checkout page shows the same totals.

## 4. Order access
- [ ] Before approval: dashboard "Bundle revenue" shows the critical "Shopify has not approved order access" banner and
      "Revenue is unavailable" (no zeros); no retry on every page view.
- [ ] After approval + restart: "Sync orders now" succeeds; banner disappears (U).
- [ ] `/app/dev/capture-order?number=<n>` saves a sanitized file in `.captures/` (dev only, read-only); open the file
      and confirm no names, emails, phones or addresses.

## 5. Revenue attribution (place each order, then Sync)
- [ ] A. Full bundle via block. Net revenue = discounted subtotal; order reconciles (no "estimate" banner) (U).
- [ ] B. Same products added individually: same result.
- [ ] C. Bundle + unrelated product: unrelated item excluded from revenue.
- [ ] D. Two bundles in one cart: per-bundle rows; units not double counted.
- [ ] E. Quantity 2 of every item: two sets; discount equals Shopify's recorded total (pooled rounding, U).
- [ ] F. Order in a second currency/market if available (U); other-currency orders listed as excluded, not summed.
- [ ] G. Re-run "Sync orders now" three times: numbers and order counts do not change.
- [ ] H. Edit the bundle (price/items) after A: order A's figures stay the same.

## 6. Refunds, cancellations, edits (each on a fresh order)
- [ ] Refund one bundle item with restock: net revenue drops by its paid share; sets drop (U).
- [ ] Refund the same item again / sync repeatedly: no further deduction.
- [ ] Refund every bundle item: revenue returns to zero for that order.
- [ ] Amount-only refund, shipping-only refund, tax-only refund: bundle revenue unchanged; blue "refunded without naming products" note shows (U).
- [ ] Cancel an order (with and without refund): excluded from orders, value shown under refunds and cancellations (U).
- [ ] Edit an order (remove a bundle item / change quantity): note appears or order becomes an estimate; no crash (U).

## 7. Dashboard
- [ ] Never synced: "has not been synced yet". Synced with no bundle orders: explicit zero. With orders: totals, average, per-bundle table.
- [ ] Gross sales, discounts, net sold, refunded, net revenue reconcile arithmetically on screen.
- [ ] Period selector 7/30/60 changes figures; historical vs live counts are right (orders from before tracking began are "historical").
- [ ] A failed sync after a good one keeps old numbers and shows a warning banner.
- [ ] The bundle edit page shows a "Revenue, last 30 days" panel with the same unsynced / unavailable / zero / data rules.

## 8. Webhooks (only after approval; uncomment the subscription in `shopify.app.toml`, then restart)
- [ ] `orders/paid`, `orders/cancelled`, `refunds/create` arrive at `/webhooks/orders` and update the dashboard without a manual sync (U).
- [ ] Redelivery of the same event changes nothing; an unsigned request is rejected with 401.

## 9. Privacy and cleanup
- [ ] No customer fields in `prisma/dev.sqlite` revenue tables (`OrderRecord`, `BundleOrderRevenue`).
- [ ] Uninstall the app: bundle and revenue tables for the shop are emptied (do this last).

## 10. Orders and Suggestions
These now live on the Dashboard as compact sections (top 5 orders, top 3 suggestions); the full pages open from "View all" and "See all suggested bundles".
- [ ] **Orders** (nav): order #1001 appears with its number, a "Historical" badge, bundle FBT, gross, discount, refunded, net, and a link that opens the order in Shopify. (Older records get their order number on the next sync.)
- [ ] Change the period and the "Show" filter (live, historical, estimates, refunded, cancelled); the list changes, and a filter with no matches says so by name.
- [ ] After a refund or cancellation (section 6), the order shows Partly refunded / Refunded / Cancelled; an estimate shows its reason.
- [ ] Break order access (or test before approval): Orders says "unavailable", never "no orders".
- [ ] **Suggestions** (nav): with at least two orders that contain the same two products, that pair appears with "bought together in N orders", list price, bundle price at 10%, and "Small sample" under 5 orders. The page says these are patterns, not predictions.
- [ ] A pair already inside an active bundle is not suggested. Refresh suggestions recomputes.
- [ ] **Create this bundle** opens the create form with both products, a name, 10% off and status Draft; nothing is saved until you click Save.

## 11. Dashboard sections and Analytics
- [ ] Navigation shows Dashboard, Bundles, Analytics, Diagnostics only.
- [ ] Dashboard: "Recent bundle orders" shows the newest orders and "View all N order(s)" opens the full Orders page (filters, paging).
- [ ] Dashboard: "Suggested bundles" shows "Looking for…" first, then up to 3 suggestions; the rest of the page does not wait for it. "See all suggested bundles" opens the full page; "Create this bundle" opens a prefilled draft.
- [ ] Analytics: pick 7, 30 and 60 days. Net revenue and bundle orders equal the Dashboard's for the same period; the daily bars add up to net revenue.
- [ ] Analytics chart: hover a bar (readout updates), Tab through bars, open "View as table", and switch Shopify to dark mode (bars and text stay readable).
- [ ] Break order access (or test before approval): Analytics still shows views and add-to-cart, revenue shows "unavailable", never $0.
- [ ] Per-bundle table: a bundle with views but no orders shows "—" for rates it cannot compute and 0 orders.

## 12. Brand styling
- [ ] Dashboard: logo header with status chips, and teal-edged tiles for bundle counts and revenue. Analytics tiles look the same.
- [ ] Analytics chart bars are teal; switch Shopify to dark mode and check tiles, bars and text are readable.
- [ ] Theme editor: add a new Bundle block. Its accent defaults to teal and the button, plus badges and savings pill use it. An existing block keeps its old colour until you change it.
- [ ] Upload `docs/brand/app-icon-1200.png` as the app icon in the Dev Dashboard and check the sidebar icon.
