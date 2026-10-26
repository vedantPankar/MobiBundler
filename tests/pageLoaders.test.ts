import { beforeEach, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createRevenueRepo } from "../app/bundles/revenue.repo.server";
import { createTestPrisma, resetTestDb } from "./testDb";

// authenticate.admin is mocked (it needs a real Shopify session). Everything else is real: the routes, repos and
// test database. The Shopify GraphQL API is a fake that answers by operation name; its shapes are unverified.
const state = vi.hoisted(() => ({ sync: vi.fn(async (..._a: unknown[]) => ({ ok: true })), prisma: null as unknown, shop: "a.myshopify.com", baskets: null as unknown, calls: [] as string[], variants: {} as Record<string, unknown> }));
vi.mock("../app/shopify.server", () => ({
  authenticate: {
    admin: async () => ({
      session: { shop: state.shop },
      admin: {
        graphql: async (q: string, o?: { variables?: { ids?: string[] } }) => {
          const op = /query (\w+)/.exec(q)![1];
          state.calls.push(op);
          const body =
            op === "BundleShopCurrency" ? { data: { shop: { currencyCode: "USD" } } }
            : op === "BundleVariantDetails" ? { data: { nodes: (o?.variables?.ids ?? []).map((id) => state.variants[id] ?? null) } }
            : op === "OrderBaskets" ? state.baskets
            : { data: {} };
          if (body === null) throw new Error("This app is not approved to access the Order object.");
          return { json: async () => body };
        },
      },
    }),
  },
}));
vi.mock("../app/bundles/index.server", async () => {
  const { createBundleRepo: cb } = await import("../app/bundles/repo.server");
  const { createRevenueRepo: cr } = await import("../app/bundles/revenue.repo.server");
  const live = <T extends object>(make: (p: never) => T) => new Proxy({}, { get: (_t, k) => (make(state.prisma as never) as Record<string | symbol, unknown>)[k] }) as T;
  return { bundleRepo: live(cb), revenueRepo: live(cr), syncForShop: vi.fn(), syncRevenueForShop: (...a: unknown[]) => state.sync(...a) };
});

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const variantNode = (n: number, price: string, over: object = {}) => ({
  id: V(n), title: "Default Title", price, inventoryQuantity: 5, inventoryItem: { tracked: true }, media: { nodes: [] },
  product: { id: `gid://shopify/Product/${n}`, title: `Product ${n}`, status: "ACTIVE" }, ...over,
});
const basketPage = (orders: number[][]) => ({
  data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: orders.map((v, i) => ({ id: `gid://shopify/Order/${i}`, lineItems: { nodes: v.map((n) => ({ variant: { id: V(n) } })) } })) } },
});
const req = (qs = "") => new Request(`http://x/app/page${qs}`);

beforeEach(async () => {
  const p = await createTestPrisma();
  await resetTestDb(p);
  state.prisma = p;
  state.shop = "a.myshopify.com";
  state.calls = [];
  state.sync.mockClear();
  state.baskets = basketPage([]);
  state.variants = { [V(1)]: variantNode(1, "100.00"), [V(2)]: variantNode(2, "50.00") };
  vi.resetModules();
});

test("orders page: unknown parameters fall back to safe defaults and only this shop's orders are listed", async () => {
  const bundles = createBundleRepo(state.prisma as never);
  const revenue = createRevenueRepo(state.prisma as never);
  await bundles.create("a.myshopify.com", "USD", { name: "P", status: "active", pricingKind: "percentage", pricingValue: 1000,
    items: [{ productId: "gid://shopify/Product/1", variantId: V(1), quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: V(2), quantity: 1 }] });
  const base = { orderedAt: new Date(), cancelledAt: null, currencyCode: "USD", source: "live" as const, fingerprint: "f", linesHash: "h", linesJson: "[]", refundsJson: "[]", attributionJson: "{}", reconciled: true, reconcileNote: null, unmappedRefundMinor: 0 };
  await revenue.saveOrder({ ...base, shop: "a.myshopify.com", orderId: "gid://shopify/Order/1", orderName: "#1001" }, []);
  await revenue.saveOrder({ ...base, shop: "b.myshopify.com", orderId: "gid://shopify/Order/2", orderName: "#2001" }, []);
  const { loader } = await import("../app/routes/app.orders");
  const d = (await loader({ request: req("?days=9999&show=%3Cscript%3E&page=-4") } as never)) as { rows: { label: string }[]; days: number; filter: string; page: number; total: number };
  expect([d.days, d.filter, d.page, d.total]).toEqual([30, "all", 1, 1]);
  expect(d.rows.map((r) => r.label)).toEqual(["#1001"]);
});

test("suggestions page: a good result is cached, refresh clears it, and the approval error becomes a banner state", async () => {
  state.baskets = basketPage([[1, 2], [1, 2], [1, 2]]);
  const { loader, action } = await import("../app/routes/app.suggestions");
  const first = (await loader({ request: req() } as never)) as { result: { suggestions: { together: number }[] } | null; error: unknown };
  expect(first.result!.suggestions[0].together).toBe(3);
  const ordersCalls = () => state.calls.filter((c) => c === "OrderBaskets").length;
  expect(ordersCalls()).toBe(1);
  await loader({ request: req() } as never);
  expect(ordersCalls()).toBe(1); // served from the cache
  await action({ request: req() } as never);
  await loader({ request: req() } as never);
  expect(ordersCalls()).toBe(2); // refresh recomputed

  state.shop = "c.myshopify.com"; // a different shop has its own cache entry and its own failure
  state.baskets = null;
  const failed = (await loader({ request: req() } as never)) as { result: unknown; error: { code: string } };
  expect(failed.result).toBeNull();
  expect(failed.error.code).toBe("ACCESS_NOT_APPROVED");
});

test("create-bundle page: a suggestion link prefills a draft; anything malformed gives the normal blank form", async () => {
  const { loader } = await import("../app/routes/app.bundles.new");
  type D = { currencyCode: string; prefill: { items: { variantId: string; priceMinor: number; label: string }[]; discountBps: number; name: string } | null };
  const ok = (await loader({ request: req("?variants=1,2&discount=15") } as never)) as D;
  expect(ok.prefill!.discountBps).toBe(1500);
  expect(ok.prefill!.items.map((i) => [i.variantId, i.priceMinor])).toEqual([[V(1), 10000], [V(2), 5000]]);
  expect(ok.prefill!.name).toBe("Product 1 + Product 2");

  expect(((await loader({ request: req("?variants=1,x") } as never)) as D).prefill).toBeNull();
  expect(((await loader({ request: req("") } as never)) as D).prefill).toBeNull();
  // a variant that no longer exists leaves fewer than two items: blank form, not a half-filled bundle
  state.variants = { [V(1)]: variantNode(1, "100.00") };
  expect(((await loader({ request: req("?variants=1,2") } as never)) as D).prefill).toBeNull();
});

const seedOrder = async (shop: string, n: number, opts: { cancelled?: boolean } = {}) => {
  const bundles = createBundleRepo(state.prisma as never);
  const revenue = createRevenueRepo(state.prisma as never);
  let b = (await bundles.list(shop))[0];
  if (!b) {
    b = await bundles.create(shop, "USD", { name: "Pair", status: "active", pricingKind: "percentage", pricingValue: 1000,
      items: [{ productId: "gid://shopify/Product/1", variantId: V(1), quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: V(2), quantity: 1 }] });
  }
  await revenue.saveOrder(
    { shop, orderId: `gid://shopify/Order/${n}`, orderName: `#${1000 + n}`, orderedAt: new Date(), cancelledAt: opts.cancelled ? new Date() : null, currencyCode: "USD", source: "live",
      fingerprint: `f${n}`, linesHash: "h", linesJson: "[]", refundsJson: "[]", attributionJson: "{}", reconciled: true, reconcileNote: null, unmappedRefundMinor: 0 },
    [{ bundleId: b.id, sets: 1, unitsSold: 2, unitsRefunded: 0, soldGrossMinor: 10000, soldDiscountMinor: 1000, netMinor: opts.cancelled ? 0 : 9000 }],
  );
  return b;
};
const markSynced = async (shop: string, minutesAgo: number) => {
  const revenue = createRevenueRepo(state.prisma as never);
  const at = new Date(Date.now() - minutesAgo * 60_000);
  await revenue.ensureState(shop, at);
  await revenue.recordSuccess(shop, at, null);
};

test("analytics page: counts storefront events and revenue per bundle, ignores other shops, and defaults a bad period", async () => {
  const b = await seedOrder("a.myshopify.com", 1);
  await seedOrder("b.myshopify.com", 2);
  const p = state.prisma as Awaited<ReturnType<typeof createTestPrisma>>;
  await p.bundleEvent.createMany({ data: [
    { shop: "a.myshopify.com", bundleId: b.id, type: "view", dedupeKey: "k1" },
    { shop: "a.myshopify.com", bundleId: b.id, type: "view", dedupeKey: "k2" },
    { shop: "a.myshopify.com", bundleId: b.id, type: "add_to_cart", dedupeKey: "k3" },
  ] });
  await markSynced("a.myshopify.com", 1);
  const { loader } = await import("../app/routes/app.analytics");
  const d = (await loader({ request: req("?days=12345") } as never)) as { days: number; revenueState: string; result: { kpis: { views: number; addToCarts: number; orders: number; netRevenueMinor: number; viewToCartRate: number }; perBundle: { name: string }[]; daily: unknown[] } };
  expect(d.days).toBe(30);
  expect(d.revenueState).toBe("data");
  expect(d.result.kpis).toMatchObject({ views: 2, addToCarts: 1, orders: 1, netRevenueMinor: 9000, viewToCartRate: 0.5 });
  expect(d.result.perBundle.map((x) => x.name)).toEqual(["Pair"]);
  expect(d.result.daily.length).toBeGreaterThanOrEqual(30);
});

test("analytics page: storefront counts still load when order access has never worked", async () => {
  const bundles = createBundleRepo(state.prisma as never);
  const revenue = createRevenueRepo(state.prisma as never);
  const b = await bundles.create("a.myshopify.com", "USD", { name: "Pair", status: "active", pricingKind: "percentage", pricingValue: 1000,
    items: [{ productId: "gid://shopify/Product/1", variantId: V(1), quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: V(2), quantity: 1 }] });
  await (state.prisma as Awaited<ReturnType<typeof createTestPrisma>>).bundleEvent.create({ data: { shop: "a.myshopify.com", bundleId: b.id, type: "view", dedupeKey: "k" } });
  await revenue.ensureState("a.myshopify.com", new Date());
  await revenue.recordError("a.myshopify.com", new Date(), "Shopify has not approved this app to read orders yet.", "ACCESS_NOT_APPROVED");
  const { loader } = await import("../app/routes/app.analytics");
  const d = (await loader({ request: req() } as never)) as { revenueState: string; sync: { errorCode: string }; result: { kpis: { views: number } } };
  expect(d.revenueState).toBe("unavailable");
  expect(d.sync.errorCode).toBe("ACCESS_NOT_APPROVED");
  expect(d.result.kpis.views).toBe(1);
});

test("dashboard: recent orders are included, order refresh is throttled, and streamed suggestions never reject", async () => {
  for (let n = 1; n <= 7; n++) await seedOrder("a.myshopify.com", n);
  await markSynced("a.myshopify.com", 1);
  // products 3 and 4 sold together twice; 1 and 2 are already inside the active bundle, so they are not suggested
  state.baskets = basketPage([[3, 4], [3, 4], [1, 2], [1, 2]]);
  state.variants = { ...state.variants, [V(3)]: variantNode(3, "30.00"), [V(4)]: variantNode(4, "40.00") };
  const { loader } = await import("../app/routes/app._index");
  type D = { recentOrders: { rows: { label: string }[]; total: number }; suggestions: Promise<{ result: { suggestions: unknown[] } | null; error: { code: string } | null }> };
  const d = (await loader({ request: req() } as never)) as D;
  expect(d.recentOrders.total).toBe(7);
  expect(d.recentOrders.rows).toHaveLength(5); // only the newest few on the dashboard
  expect(state.sync).not.toHaveBeenCalled(); // synced a minute ago
  expect(d.suggestions).toBeInstanceOf(Promise);
  expect((await d.suggestions).result!.suggestions).toHaveLength(1);

  // stale data refreshes orders; a Shopify refusal in suggestions is a resolved error, not a rejected promise
  await markSynced("a.myshopify.com", 30);
  state.shop = "a.myshopify.com";
  state.baskets = null;
  vi.resetModules();
  const again = (await (await import("../app/routes/app._index")).loader({ request: req() } as never)) as D;
  expect(state.sync).toHaveBeenCalledTimes(1);
  await expect(again.suggestions).resolves.toMatchObject({ result: null, error: { code: expect.any(String) } });
});
