import { beforeEach, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { runDiagnostics } from "../app/bundles/diagnostics.server";
import { serializeSharedConfig, MAX_ACTIVE_BUNDLES } from "../app/bundles/config";
import type { DiscountGateway } from "../app/bundles/sync.server";
import { createTestPrisma, resetTestDb } from "./testDb";
import type { BundleInput } from "../app/bundles/types";

const S = "a.myshopify.com";
const input = (name: string, v1 = 1, v2 = 2): BundleInput => ({
  name,
  status: "active",
  pricingKind: "percentage",
  pricingValue: 1000,
  items: [
    { productId: `gid://shopify/Product/${v1}`, variantId: `gid://shopify/ProductVariant/${v1}`, quantity: 1 },
    { productId: `gid://shopify/Product/${v2}`, variantId: `gid://shopify/ProductVariant/${v2}`, quantity: 1 },
  ],
});
let prisma: Awaited<ReturnType<typeof createTestPrisma>>;
let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => {
  prisma = await createTestPrisma();
  await resetTestDb(prisma);
  repo = createBundleRepo(prisma);
});

const gw = (node: { status: string; configJson: string | null } | null): DiscountGateway => ({
  create: async () => ({ discountId: "x" }),
  update: async () => {},
  setActive: async () => {},
  inspect: async () => node,
});
const allVariants = async (ids: string[]) => new Map(ids.map((i) => [i, {}]));
const run = (g: DiscountGateway, over: Partial<Parameters<typeof runDiagnostics>[0]> = {}) =>
  runDiagnostics({ shop: S, repo, prisma, gateway: g, fetchVariants: allVariants, grantedScopes: ["read_products", "write_discounts", "write_app_proxy"], ...over });
const codes = (r: { code: string }[]) => r.map((x) => x.code);

async function syncedShop(n = 1) {
  const bundles = [];
  for (let i = 0; i < n; i++) bundles.push(await repo.create(S, "USD", input(`B${i}`, i * 2 + 1, i * 2 + 2)));
  const json = serializeSharedConfig(await repo.activeForShop(S)).json;
  await prisma.shopDiscount.upsert({ where: { shop: S }, create: { shop: S, shopifyDiscountId: "d1" }, update: { shopifyDiscountId: "d1" } });
  return { bundles, json };
}

test("clean shop reports ALL_OK", async () => {
  const { json } = await syncedShop();
  expect(codes(await run(gw({ status: "ACTIVE", configJson: json })))).toEqual(["ALL_OK"]);
});
test("no active bundles needs no discount", async () => {
  expect(codes(await run(gw(null)))).toEqual(["ALL_OK"]);
});
test("missing discount (no row or Shopify returns null)", async () => {
  await repo.create(S, "USD", input("A"));
  expect(codes(await run(gw(null)))).toContain("DISCOUNT_MISSING");
  await prisma.shopDiscount.create({ data: { shop: S, shopifyDiscountId: "d1" } });
  expect(codes(await run(gw(null)))).toContain("DISCOUNT_MISSING");
});
test("inactive discount", async () => {
  const { json } = await syncedShop();
  expect(codes(await run(gw({ status: "EXPIRED", configJson: json })))).toContain("DISCOUNT_INACTIVE");
});
test("config drift, but not for merely re-ordered JSON keys", async () => {
  const { json } = await syncedShop();
  expect(codes(await run(gw({ status: "ACTIVE", configJson: '{"v":1,"bundles":[]}' })))).toContain("CONFIG_DRIFT");
  const reordered = JSON.stringify(JSON.parse(json), (_k, v) => (v && !Array.isArray(v) && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse()) : v));
  expect(codes(await run(gw({ status: "ACTIVE", configJson: reordered })))).not.toContain("CONFIG_DRIFT");
});
test("sync error is surfaced", async () => {
  const { bundles, json } = await syncedShop();
  await repo.markSync(S, [bundles[0].id], "error", "boom");
  const r = await run(gw({ status: "ACTIVE", configJson: json }));
  expect(codes(r)).toContain("SYNC_ERROR");
  expect(r.find((x) => x.code === "SYNC_ERROR")!.message).toContain("boom");
});
test("missing variant names the bundle", async () => {
  const { json } = await syncedShop();
  const r = await run(gw({ status: "ACTIVE", configJson: json }), { fetchVariants: async () => new Map() });
  expect(r.find((x) => x.code === "VARIANT_MISSING")!.message).toContain("B0");
});
test("overlap warning when a variant is in two active bundles", async () => {
  await repo.create(S, "USD", input("A", 1, 2));
  await repo.create(S, "USD", input("B", 1, 3));
  await prisma.shopDiscount.create({ data: { shop: S, shopifyDiscountId: "d1" } });
  const json = serializeSharedConfig(await repo.activeForShop(S)).json;
  expect(codes(await run(gw({ status: "ACTIVE", configJson: json })))).toContain("OVERLAP");
});
test("budget warning near the active-bundle limit, over-limit never throws", async () => {
  const { json } = await syncedShop(Math.ceil(MAX_ACTIVE_BUNDLES * 0.85));
  expect(codes(await run(gw({ status: "ACTIVE", configJson: json })))).toContain("CONFIG_BUDGET");
  await repo.create(S, "USD", input("Extra", 900, 901));
  await repo.create(S, "USD", input("Extra2", 902, 903));
  await repo.create(S, "USD", input("Extra3", 904, 905));
  await repo.create(S, "USD", input("Extra4", 906, 907));
  expect(codes(await run(gw({ status: "ACTIVE", configJson: json })))).toContain("CONFIG_BUDGET");
});
test("missing scope is critical", async () => {
  expect(codes(await run(gw(null), { grantedScopes: ["read_products"] }))).toContain("SCOPE_MISSING");
});
test("diagnostics are scoped to the shop", async () => {
  await repo.create("b.myshopify.com", "USD", input("Other"));
  expect(codes(await run(gw(null)))).toEqual(["ALL_OK"]);
});
