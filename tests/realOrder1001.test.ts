import { readFileSync } from "node:fs";
import { beforeEach, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createRevenueRepo } from "../app/bundles/revenue.repo.server";
import { normalizeOrder, type RawOrder } from "../app/bundles/orderNormalizer";
import { attributeOrder } from "../app/bundles/attribution";
import { reconcile } from "../app/bundles/revenueIngest.server";
import { buildSharedConfig } from "../app/bundles/config";
import { syncOrders } from "../app/bundles/revenueSync.server";
import { createTestPrisma, resetTestDb } from "./testDb";

// REAL data: tests/fixtures/order-1001.json is order #1001 as Shopify returned it through Admin GraphQL (captured on
// the dev store, 2026-10-25). It holds no customer fields. It is the ONLY real order seen so far: a full bundle bought
// through the block, no refunds, no cancellation, single currency.
const real = JSON.parse(readFileSync("tests/fixtures/order-1001.json", "utf8")).data.order as RawOrder;
const S = "a.myshopify.com";
const LIQ = "gid://shopify/ProductVariant/50798419509434";
const OXY = "gid://shopify/ProductVariant/50798419411130";

let prisma: Awaited<ReturnType<typeof createTestPrisma>>;
let bundles: ReturnType<typeof createBundleRepo>;
let repo: ReturnType<typeof createRevenueRepo>;
const make = (bps = 1000) =>
  bundles.create(S, "USD", {
    name: "FBT", status: "active", pricingKind: "percentage", pricingValue: bps,
    items: [
      { productId: "gid://shopify/Product/10393927057594", variantId: LIQ, quantity: 1 },
      { productId: "gid://shopify/Product/10393926959290", variantId: OXY, quantity: 1 },
    ],
  });

beforeEach(async () => {
  prisma = await createTestPrisma();
  await resetTestDb(prisma);
  bundles = createBundleRepo(prisma);
  repo = createRevenueRepo(prisma);
});

test("the real order carries no customer fields", () => {
  expect(JSON.stringify(real)).not.toMatch(/customer|email|phone|address|billing|shipping/i);
});

test("our discount is recognised by the title Shopify recorded, per line, in minor units", () => {
  const n = normalizeOrder(real);
  expect(n.recordedDiscountByLine).toEqual({
    "gid://shopify/LineItem/17097079324858": 10250,
    "gid://shopify/LineItem/17097079357626": 7499,
  });
  expect(n.lines.map((l) => [l.quantity, l.unitPriceMinor])).toEqual([[1, 102500], [1, 74995]]);
  expect(n.currencyCode).toBe("USD");
  expect(n.warnings).toEqual([]);
});

test("replaying the checkout engine reproduces Shopify's recorded per-line allocation exactly", async () => {
  await make();
  const n = normalizeOrder(real);
  const a = attributeOrder(buildSharedConfig(await bundles.list(S)).bundles, n.lines);
  expect(reconcile(a, n.recordedDiscountByLine, n.warnings)).toBeNull();
});

test("a discount from someone else's automatic discount is not mistaken for ours", () => {
  const o = structuredClone(real);
  for (const l of o.lineItems!.nodes!) for (const d of l.discountAllocations!) d.discountApplication = { __typename: "AutomaticDiscountApplication", title: "Summer sale" };
  expect(normalizeOrder(o).recordedDiscountByLine).toEqual({});
  for (const l of o.lineItems!.nodes!) for (const d of l.discountAllocations!) d.discountApplication = { __typename: "DiscountCodeApplication", title: "Bundle discount" };
  expect(normalizeOrder(o).recordedDiscountByLine).toEqual({});
});

test("synced end to end: reconciled, net revenue equals what the customer paid", async () => {
  await make();
  const r = await syncOrders({ shop: S, repo, bundleRepo: bundles, fetchPage: async () => ({ orders: [real], hasNext: false, endCursor: null }) });
  expect(r).toMatchObject({ ok: true, created: 1 });
  const [row] = await prisma.bundleOrderRevenue.findMany();
  // 1,025.00 + 749.95 = 1,774.95 list; 177.49 discount; 1,597.46 paid for the bundle items
  expect(row).toMatchObject({ reconciled: true, soldGrossMinor: 177495, soldDiscountMinor: 17749, netMinor: 159746, unitsSold: 2, sets: 1 });
});

test("an order wrongly flagged as an estimate recovers on the next sync even though the cursor has moved on", async () => {
  const bad = await make(5000); // wrong config at first sync: replay disagrees with what Shopify recorded
  await syncOrders({ shop: S, repo, bundleRepo: bundles, fetchPage: async () => ({ orders: [real], hasNext: false, endCursor: null }) });
  expect((await prisma.orderRecord.findFirst())!.reconciled).toBe(false);
  await bundles.update(S, bad.id, bad.version, { name: "FBT", status: "active", pricingKind: "percentage", pricingValue: 1000,
    items: [
      { productId: "gid://shopify/Product/10393927057594", variantId: LIQ, quantity: 1 },
      { productId: "gid://shopify/Product/10393926959290", variantId: OXY, quantity: 1 },
    ] });
  // the page returns nothing new (cursor is past the order); only the re-check can fix it
  const r = await syncOrders({ shop: S, repo, bundleRepo: bundles, fetchPage: async () => ({ orders: [], hasNext: false, endCursor: null }), fetchOrder: async () => real });
  expect(r.updated).toBe(1);
  expect((await prisma.orderRecord.findFirst())!.reconciled).toBe(true);
  expect((await prisma.bundleOrderRevenue.findFirst())!.netMinor).toBe(159746);
});
