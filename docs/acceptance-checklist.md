# Acceptance checklist (tracked)

Acceptance criteria for the whole app. The manual script is [full-app-test-checklist.md](full-app-test-checklist.md);
section numbers and letters below match it. Updated 2026-10-25 after protected customer data access was selected for the dev store and order #1001 was read.

## Status vocabulary

| Status | Meaning |
|--------|---------|
| **Verified** | Passed a manual test on the dev store, with the date and evidence recorded in this file. |
| **Automated test passed** | The behavior can be fully judged without Shopify and its automated tests pass. Manual confirmation is still listed in the Manual column. |
| **Manual test pending** | Needs a person in the Shopify admin or storefront; no Shopify approval needed. |
| **Blocked by Shopify access** | Cannot be tried until Shopify grants something. None right now: dev-store order access is granted (see 0.3). |
| **Not implemented** | Not built. |

Rule: an item is "Automated test passed" only if a Shopify payload is not needed to judge it. Anything whose
acceptance depends on what Shopify actually sends stays "Manual test pending" until someone runs it, even where
fixture tests pass. Most fixture orders in the tests are synthetic; the one real order is
`tests/fixtures/order-1001.json` (see `tests/realOrder1001.test.ts`).

Dependencies: **PCD** = protected customer data access (Level 1) for the Order object. **FN** = live behavior of the
discount Function / app discount (README "Unverified behavior").

## 0. Preconditions
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 0.1 | Dev starts; migrations apply | Verified | all migrations are applied by `tests/globalSetup.ts`; `schemaParity` | Verified 2026-10-25 (owner): npm run dev starts and runs | - |
| 0.2 | Suites green | Verified | `npx vitest run` 231/231, function suite 34/34, `npm run build` | Verified 2026-10-25 (owner): `npx vitest run` run by owner, passing | - |
| 0.3 | Protected customer data requested | Verified | - | Verified 2026-10-25: reasons "App functionality, Analytics" saved, 9/9 data-protection answers, no customer fields; dashboard then read orders | PCD (dev store only; a public listing still needs review) |

## 1. Bundles
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 1.1 | Create percentage bundle; list; Diagnostics ALL_OK | Verified | `saveBundle`, `validation`, `repo`, `diagnostics` | Verified 2026-10-24: percentage bundle FBT created and active; Diagnostics showed ALL_OK (screenshot) | FN |
| 1.2 | Fixed-amount bundle; edit, duplicate, pause, activate, archive | Verified | `validation`, `repo`, `bundlesListAction`, `sync`, engine fixed-amount tests | Verified 2026-10-25 (owner): fixed-amount bundle created; edit, duplicate, pause, activate, archive all worked | FN |
| 1.3 | Duplicate-name and shared-variant warnings | Verified | `saveBundle` (duplicate name), `repo`, `diagnostics` (overlap) | Verified 2026-10-25 (owner): duplicate-name error and shared-variant warning both worked | - |

## 2. Storefront block
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 2.1 | Empty ID auto-shows the bundle on its products | Verified | `repo` (activeIdsForProduct), `appProxyBundles` (product param, shop isolation), `storefrontCart` (bundleQuery) | Verified 2026-10-24 (owner QA pass): bundled product showed its bundle with the ID field empty | - |
| 2.2 | Pasted ID overrides auto-detection | Verified | `storefrontCart` (bundleQuery), `appProxyBundles` (ids) | Verified 2026-10-25 (owner): pasted bundle ID works | - |
| 2.3 | No bundle: hidden live, explained in editor | Verified | `storefrontCart` (emptyMessage) | Verified 2026-10-24 (owner QA pass): unbundled product shows the editor message | - |
| 2.4 | Mobile layout, wrapping names | Verified | none (CSS only) | Verified 2026-10-24 (owner QA pass): mobile layout and long variant names | - |
| 2.5 | Add to theme buttons open the editor with the block | Verified | `themeLinks` (link shape only) | Verified 2026-10-25 (owner): Add to theme buttons open the editor with the block | - |

## 3. Cart and checkout
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 3.1 | Block add-to-cart discount equals block price | Verified | `allocationReplay`, Function engine tests, `storefrontCart` payload | Verified 2026-10-25 (owner): fixed-amount bundle added to cart through the block, discount correct | FN |
| 3.2 | Individually added items discount the same | Verified | `attribution` (individual), Function engine pooled-line test | Verified 2026-10-25 (owner): products added to the cart separately still get the bundle discount | FN |
| 3.3 | Overlapping bundles discount each unit once | Manual test pending | engine "never discounted twice", `attributionInvariants` | pending | FN |
| 3.4 | Pause removes discount; checkout equals cart | Manual test pending | `sync` (deactivation) | pending | FN |

## 4. Order access
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 4.1 | Before approval: critical banner, "unavailable", no zeros, no retry per page view | Automated test passed | `revenueSection` (banner, no zeros), `revenueIngest` (error codes), `revenueSection` (throttle). Shopify's real refusal text was seen via the capture route | pending (dashboard) | - |
| 4.2 | After approval: sync works, banner clears | Verified | `revenueIngest` (clears on success) | Verified 2026-10-25: dashboard showed "Last synced 10/25/2026 12:04 AM", no banner, order #1001 imported | PCD |
| 4.3 | Capture file saved and sanitized | Verified | `capture` (sanitizer), `realOrder1001` (no customer fields) | Verified 2026-10-25: `.captures/1792866943216-order-graphql-1001.json` read; contains no customer, address, email or phone fields | PCD |

## 5. Revenue attribution (each needs a real order)
| ID | Item | Status | Automated evidence (fixtures) | Manual | Depends on |
|----|------|--------|-------------------------------|--------|------------|
| 5.A | Full bundle: net revenue and reconciliation | Verified | `attribution`, `allocationReplay`, `realOrder1001` (REAL order #1001: replay reproduces Shopify's per-line allocations exactly) | Verified 2026-10-25 (owner): after the fix, the estimate warning on order #1001 was gone; net revenue $1,597.46 | PCD |
| 5.B | Same products added individually | Manual test pending | `attribution`, `revenueIngest` | pending | PCD |
| 5.C | Bundle plus unrelated item | Manual test pending | `attribution`, `revenueIngest` | pending | PCD |
| 5.D | Two bundles in one cart | Manual test pending | `attribution`, `revenueIngest`, `attributionInvariants` | pending | PCD |
| 5.E | Quantity 2, pooled rounding | Manual test pending | `attribution` (pooled), `revenueIngest` | pending | PCD |
| 5.F | Second currency | Manual test pending | `attribution` (JPY, KWD), `revenueIngest` (JPY, mismatch), `revenueSection` (split) | needs a second market | PCD |
| 5.G | Repeated sync changes nothing | Verified | `revenueIngest` (idempotent, concurrent) | Verified 2026-10-25 (owner): clicking Sync orders now repeatedly changes nothing | PCD |
| 5.H | Bundle edit does not change old orders | Verified | `revenueIngest` (frozen attribution) | Verified 2026-10-25 (owner screenshot): FBT edited from 10% to $20 off; order #1001 still shows its original $177.49 discount, no estimate warning, after a sync at 00:24:37 | PCD |

## 6. Refunds, cancellations, edits (each needs a real order and refund)
| ID | Item | Status | Automated evidence (fixtures) | Manual | Depends on |
|----|------|--------|-------------------------------|--------|------------|
| 6.1 | Partial refund with restock; sets drop | Manual test pending | `attribution` (refunds, sets), `revenueIngest` | pending | PCD |
| 6.2 | Repeated refund: no further deduction | Manual test pending | `attribution`, `revenueIngest`, `webhooksOrders` | pending | PCD |
| 6.3 | Refund every item returns zero | Manual test pending | `attribution`, `attributionInvariants` | pending | PCD |
| 6.4 | Amount, shipping and tax refunds leave revenue unchanged | Manual test pending | `revenueIngest` (refund kinds). Shipping and tax refunds are modelled only as "a refund naming no products": how Shopify represents them is unverified (no real refund seen yet) | pending | PCD |
| 6.5 | Cancellation, with and without refund | Manual test pending | `attribution`, `revenueIngest`, `webhooksOrders` | pending | PCD |
| 6.6 | Order edit (remove item, change quantity) | Manual test pending | `revenueIngest` (order edits). How edits show on the order is unverified | pending | PCD |

## 7. Dashboard
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 7.1 | Unsynced, empty and data states are distinct | Automated test passed | `revenueSection`, `revenueIngest` (view state) | pending (visual) | - |
| 7.2 | Gross, discounts, net sold, refunded, net revenue reconcile | Verified | `revenueIngest` (totals), `revenueSection` | Verified 2026-10-25 (owner screenshot): gross 1,774.95 - discounts 177.49 = net sold 1,597.46; refunds 0.00; net revenue 1,597.46 | - |
| 7.3 | Period selector; historical vs live counts | Manual test pending | `revenueIngest` (backfill vs live), `revenueSection` (counts). The selector control itself is untested | period selector works (owner, 2026-10-25); the "tracked live" count has not been non-zero yet, so this closes with the first new order | - |
| 7.4 | Failed sync after a good one keeps numbers and warns | Automated test passed | `revenueIngest`, `revenueSection` | pending | - |
| 7.5 | Per-bundle revenue panel on the bundle page | Verified | `revenueSection` (panel states) | Verified 2026-10-25 (owner): per-bundle revenue panel on the bundle edit page works | - |

## 8. Webhooks
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 8.1 | Topics arrive and update the dashboard | Manual test pending | `webhooksOrders` (route behaviour, mocked verification) | uncomment subscription after approval | PCD |
| 8.2 | Redelivery changes nothing; unsigned request gets 401 | Automated test passed | `webhookSignature` (real HMAC check with a test secret), `webhooksOrders`, `revenueIngest` | confirm once subscribed | - |

## 9. Privacy and cleanup
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 9.1 | No customer fields stored | Automated test passed | `revenueIngest` (customer-data minimisation: stored data, query text, table columns), `capture` | inspect the dev database | - |
| 9.2 | Uninstall empties bundle and revenue tables | Automated test passed | `uninstallRoute`, `webhookHandlers`, `revenueIngest` (shop erase) | uninstall last | - |

## 10. Orders and Suggestions pages (added 2026-10-25; nothing here is Verified yet)
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 10.1 | Orders page lists #1001: number, Historical badge, bundle, units, gross, discount, refunded, net | Manual test pending | `orderRows`, `ordersPage`, `ordersSection`, `pageLoaders` | open Orders in the nav; the order number fills in after the next sync (older records are re-read once). Order `name` is not yet seen in a real payload | PCD |
| 10.2 | Period, filter (live, historical, estimates, refunded, cancelled) and pagination work | Manual test pending | `ordersPage` (filters, paging, shop isolation), `pageLoaders` (bad params) | pending | - |
| 10.3 | A refunded, cancelled or estimate order shows its state and the estimate reason | Manual test pending | `orderRows`, `ordersSection` | needs the refund and cancel tests (6.x) | PCD |
| 10.4 | Orders page says "unavailable" or "not synced", never "no orders", when order access fails | Automated test passed | `ordersSection` | pending | - |
| 10.5 | Suggestions lists a pair that was bought together in two or more orders | Manual test pending | `suggestions`, `suggestionsSection`, `pageLoaders` | needs at least 2 orders containing the same two products (place test orders) | PCD |
| 10.6 | "Create this bundle" opens the create form prefilled with those products, a draft, 10% off | Manual test pending | `suggestions` (prefill parsing), `pageLoaders` (prefill loader) | pending | - |
| 10.7 | Suggestions shows the order-access banner when Shopify refuses | Automated test passed | `suggestionsSection`, `pageLoaders` | pending | - |
| 10.8 | Small samples are flagged; no forecast wording | Automated test passed | `suggestionsSection` | pending | - |
| 10.9 | Suggestions read no customer, address, price or note fields | Automated test passed | `suggestions` (query text) | - | - |

## 11. Dashboard sections and Analytics page (added 2026-10-25; nothing here is Verified yet)
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 11.1 | Dashboard shows "Recent bundle orders" (newest 5) with a "View all N order(s)" link; hidden while revenue is unsynced or unavailable | Manual test pending | `ordersSection` (compact), `pageLoaders` (dashboard) | open the Dashboard | PCD |
| 11.2 | Dashboard shows "Suggested bundles" (top 3) that fills in after the page loads, with Create this bundle and See all | Manual test pending | `suggestionsSection` (compact), `pageLoaders` (streamed promise never rejects) | open the Dashboard; confirm the page is not held up by it | PCD |
| 11.3 | Navigation is Dashboard, Bundles, Analytics, Diagnostics; /app/orders and /app/suggestions still open from the "View all" links | Manual test pending | none (navigation markup) | click through | - |
| 11.4 | Analytics numbers agree with the dashboard (net revenue, orders) for the same period | Manual test pending | `analytics` (daily total equals KPI total), `pageLoaders` | compare the two screens | PCD |
| 11.5 | Analytics shows views and add-to-cart even when order access fails, and revenue as "unavailable", never $0 | Automated test passed | `analyticsSection`, `pageLoaders` | pending | - |
| 11.6 | Revenue chart: hover readout, keyboard focus, "View as table", light and dark themes | Manual test pending | `analyticsSection` (structure, labels, table, unescaped theme CSS). Hover itself is not covered by automation | hover and Tab through the bars; switch Shopify to dark mode | - |
| 11.7 | Rates show "—" when there is nothing to divide by; bundles with only views or only orders still appear | Automated test passed | `analytics` | pending | - |

## 12. Brand styling (added 2026-10-25; nothing here is Verified yet)
| ID | Item | Status | Automated evidence | Manual | Depends on |
|----|------|--------|--------------------|--------|------------|
| 12.1 | Dashboard shows the logo header, status chips and teal-edged tiles (bundles, revenue); Analytics tiles match | Manual test pending | `brand` (tiles, header render) | open Dashboard and Analytics | - |
| 12.2 | Dark mode: tiles, chart bars and text stay readable | Manual test pending | `brand` (contrast of every pair, light and dark values) | switch Shopify to dark mode | - |
| 12.3 | New storefront blocks default to teal `#02736a`; the existing block keeps its saved colour until changed in the editor | Manual test pending | `brand` (stylesheet and editor default) | add a new Bundle block; check the old one | - |
| 12.4 | Brand colours meet contrast targets (text 4.5:1, chart bars 3:1) | Automated test passed | `brand` | - | - |
| 12.5 | App icon uploaded in the Dev Dashboard | Manual test pending | - | owner uploads `docs/brand/app-icon-1200.png` | - |

## Gaps (not part of the manual script)
| Item | Status | Note |
|------|--------|------|
| Scheduled background sync | Not implemented | Sync runs when the dashboard opens (at most every 5 minutes), on the button, and from webhooks once subscribed. No cron, so data stays stale until someone opens the dashboard. |
| Revenue older than 60 days | Not implemented | Needs `read_all_orders` approval. |
| Database-side revenue aggregation | Not implemented | Totals are summed in app code; fine for small stores. |
| Order edits modelled explicitly | Not implemented | Purchased quantities minus refunds are used; edits are only noted. |
| Suggestions: more than pairs | Not implemented | Only two-product bundles are suggested; it reads at most the 250 newest orders of the last 60 days; the result is cached for 10 minutes per server process. |
| Shipping/tax refund distinction | Not implemented | Indistinguishable from amount-only refunds in the model. |

## Tally (62 checklist items)
Verified 20 · Automated test passed 13 · Manual test pending 29 · Blocked by Shopify access 0 · Not implemented 0
(plus 6 known gaps listed above). Verified means the owner ran it on the dev store; see the Manual column for date and evidence.
