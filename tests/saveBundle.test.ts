import { beforeEach, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { saveBundle } from "../app/bundles/save.server";
import type { CatalogAdmin } from "../app/bundles/shopifyCatalog.server";
import { createTestPrisma, resetTestDb } from "./testDb";

const S = "a.myshopify.com";
const gid = (t: string, n: number) => `gid://shopify/${t}/${n}`;
const raw = (over: object = {}) => ({
  name: "Duo",
  status: "draft",
  pricingKind: "percentage",
  pricingValue: 1000,
  items: [
    { productId: gid("Product", 1), variantId: gid("ProductVariant", 1), quantity: 1 },
    { productId: gid("Product", 2), variantId: gid("ProductVariant", 2), quantity: 1 },
  ],
  ...over,
});

// Offline fake of the Admin client: proves our logic, NOT live Shopify behavior.
const adminWith = (known: number[]) =>
  ({
    graphql: vi.fn(async (q: string) => ({
      json: async () =>
        q.includes("BundleShopCurrency")
          ? { data: { shop: { currencyCode: "USD" } } }
          : {
              data: {
                nodes: [1, 2, 3].map((n) =>
                  known.includes(n)
                    ? { id: gid("ProductVariant", n), price: "10.00", product: { id: gid("Product", n) } }
                    : null,
                ),
              },
            },
    })),
  }) as unknown as CatalogAdmin;

let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => {
  const p = await createTestPrisma();
  await resetTestDb(p);
  repo = createBundleRepo(p);
});
const sync = async () => ({ status: "created" });

test("saves when every variant exists in Shopify", async () => {
  const r = await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw());
  expect(r.ok).toBe(true);
  expect(await repo.list(S)).toHaveLength(1);
});
test("rejects variants Shopify does not return (never trusts the form)", async () => {
  const r = await saveBundle({ shop: S, admin: adminWith([1]), repo, sync }, raw());
  expect(r.ok).toBe(false);
  expect((r as { fieldErrors: Record<string, string> }).fieldErrors.items).toMatch(/not found/i);
  expect(await repo.list(S)).toHaveLength(0);
});
test("rejects product id that does not match the variant's product", async () => {
  const r = await saveBundle(
    { shop: S, admin: adminWith([1, 2]), repo, sync },
    raw({
      items: [
        { productId: gid("Product", 9), variantId: gid("ProductVariant", 1), quantity: 1 },
        { productId: gid("Product", 2), variantId: gid("ProductVariant", 2), quantity: 1 },
      ],
    }),
  );
  expect(r.ok).toBe(false);
});
test("validation errors come back per field", async () => {
  const r = await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw({ pricingValue: 0 }));
  expect(r.ok).toBe(false);
  expect((r as { fieldErrors: Record<string, string> }).fieldErrors.pricingValue).toBeTruthy();
});
test("duplicate name returns a field error, not a crash", async () => {
  await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw());
  const r = await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw());
  expect((r as { fieldErrors: Record<string, string> }).fieldErrors.name).toMatch(/already/i);
});
test("active save triggers sync; draft save does not", async () => {
  const s = vi.fn(sync);
  await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync: s }, raw());
  expect(s).not.toHaveBeenCalled();
  await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync: s }, raw({ name: "Duo 2", status: "active" }));
  expect(s).toHaveBeenCalledTimes(1);
});
test("sync failure after save is reported but the bundle is kept", async () => {
  const r = await saveBundle(
    { shop: S, admin: adminWith([1, 2]), repo, sync: async () => ({ status: "error", message: "nope" }) },
    raw({ status: "active" }),
  );
  expect(r).toMatchObject({ ok: true, syncMessage: "nope" });
  expect(await repo.list(S)).toHaveLength(1);
});
test("stale version on edit reports a conflict", async () => {
  const a = (await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw())) as { bundleId: string };
  await saveBundle(
    { shop: S, admin: adminWith([1, 2]), repo, sync, id: a.bundleId, expectedVersion: 1 },
    raw({ name: "Duo v2" }),
  );
  const r = await saveBundle(
    { shop: S, admin: adminWith([1, 2]), repo, sync, id: a.bundleId, expectedVersion: 1 },
    raw({ name: "Duo v3" }),
  );
  expect((r as { message: string }).message).toMatch(/changed/i);
});
test("editing another shop's bundle id fails", async () => {
  const other = await repo.create("b.myshopify.com", "USD", raw() as never);
  const r = await saveBundle(
    { shop: S, admin: adminWith([1, 2]), repo, sync, id: other.id, expectedVersion: 1 },
    raw(),
  );
  expect(r.ok).toBe(false);
});
