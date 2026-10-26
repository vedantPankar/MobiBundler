import { beforeEach, describe, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createTestPrisma, resetTestDb } from "./testDb";
import type { BundleInput } from "../app/bundles/types";

const A = "a.myshopify.com";
const B = "b.myshopify.com";
const v = (n: number) => ({
  productId: `gid://shopify/Product/${n}`,
  variantId: `gid://shopify/ProductVariant/${n}`,
  quantity: 1,
});
const input = (name: string, over: Partial<BundleInput> = {}): BundleInput => ({
  name,
  status: "active",
  pricingKind: "percentage",
  pricingValue: 1000,
  items: [v(1), v(2)],
  ...over,
});

let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => {
  const p = await createTestPrisma();
  await resetTestDb(p);
  repo = createBundleRepo(p);
});

describe("shop isolation", () => {
  test("get/update/setStatus/duplicate never cross shops", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    expect(await repo.get(B, a.id)).toBeNull();
    expect(await repo.update(B, a.id, 1, input("Hacked"))).toBeNull();
    expect(await repo.setStatus(B, a.id, "archived")).toBeNull();
    expect(await repo.duplicate(B, a.id)).toBeNull();
    expect((await repo.get(A, a.id))!.name).toBe("Duo");
  });
  test("list, counts, activeForShop, variantsInUse are scoped", async () => {
    await repo.create(A, "USD", input("Duo"));
    await repo.create(B, "USD", input("Other"));
    expect((await repo.list(A)).map((b) => b.name)).toEqual(["Duo"]);
    expect((await repo.countsByStatus(A)).active).toBe(1);
    expect(await repo.activeForShop(B)).toHaveLength(1);
    expect(await repo.variantsInUse(A, ["gid://shopify/ProductVariant/1"])).toEqual([
      "gid://shopify/ProductVariant/1",
    ]);
    await repo.deleteAllForShop(A);
    expect(await repo.list(A)).toEqual([]);
    expect(await repo.list(B)).toHaveLength(1);
  });
  test("markSync only touches the given shop", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    await repo.markSync(B, [a.id], "error", "nope");
    expect((await repo.get(A, a.id))!.syncStatus).toBe("pending");
  });
  test("same name allowed in different shops, not within one", async () => {
    await repo.create(A, "USD", input("Duo"));
    await repo.create(B, "USD", input("Duo"));
    await expect(repo.create(A, "USD", input("Duo"))).rejects.toThrow();
  });
});

describe("behaviour", () => {
  test("optimistic concurrency", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    const u = await repo.update(A, a.id, 1, input("Duo2"));
    expect(u).not.toBe("conflict");
    expect((u as { version: number }).version).toBe(2);
    expect(await repo.update(A, a.id, 1, input("Stale"))).toBe("conflict");
  });
  test("update replaces items atomically", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    const u = (await repo.update(A, a.id, 1, input("Duo", { items: [{ ...v(3), quantity: 2 }, v(4)] }))) as {
      items: { variantId: string }[];
    };
    expect(u.items.map((i) => i.variantId)).toEqual([
      "gid://shopify/ProductVariant/3",
      "gid://shopify/ProductVariant/4",
    ]);
  });
  test("duplicate creates a draft copy with a unique name", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    const d = (await repo.duplicate(A, a.id))!;
    expect(d.status).toBe("draft");
    expect(d.name).toBe("Duo (copy)");
    expect(d.items).toHaveLength(2);
    const d2 = (await repo.duplicate(A, a.id))!;
    expect(d2.name).toBe("Duo (copy 2)");
  });
  test("search and sort", async () => {
    await repo.create(A, "USD", input("Zeta"));
    await repo.create(A, "USD", input("Alpha"));
    expect((await repo.list(A, { sort: "name", dir: "asc" })).map((b) => b.name)).toEqual(["Alpha", "Zeta"]);
    expect((await repo.list(A, { search: "alp" })).map((b) => b.name)).toEqual(["Alpha"]);
  });
  test("variantsInUse ignores archived/draft and the excluded bundle", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    expect(await repo.variantsInUse(A, ["gid://shopify/ProductVariant/1"], a.id)).toEqual([]);
    await repo.setStatus(A, a.id, "archived");
    expect(await repo.variantsInUse(A, ["gid://shopify/ProductVariant/1"])).toEqual([]);
  });
  test("archiving keeps the record and bumps the version", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    const s = (await repo.setStatus(A, a.id, "archived"))!;
    expect(s.status).toBe("archived");
    expect(s.version).toBe(2);
    expect(await repo.activeForShop(A)).toEqual([]);
  });
  test("deleting a bundle cascades its items", async () => {
    const p = await createTestPrisma();
    const a = await repo.create(A, "USD", input("Duo"));
    await p.bundle.delete({ where: { id: a.id } });
    expect(await p.bundleItem.count({ where: { bundleId: a.id } })).toBe(0);
  });
  test("unique variant per bundle is enforced by the database", async () => {
    const p = await createTestPrisma();
    const a = await repo.create(A, "USD", input("Duo"));
    await expect(
      p.bundleItem.create({ data: { bundleId: a.id, shop: A, ...v(1), position: 9 } }),
    ).rejects.toThrow();
  });
});

describe("activeIdsForProduct", () => {
  test("returns only active bundles of this shop that contain the product, newest first", async () => {
    const old = await repo.create(A, "USD", input("Old", { items: [v(1), v(2)] }));
    const fresh = await repo.create(A, "USD", input("Fresh", { items: [v(1), v(3)] }));
    await repo.create(A, "USD", input("Draft", { status: "draft", items: [v(1), v(4)] }));
    await repo.create(A, "USD", input("Other product", { items: [v(5), v(6)] }));
    await repo.create(B, "USD", input("Other shop", { items: [v(1), v(2)] }));
    expect(await repo.activeIdsForProduct(A, "1")).toEqual([fresh.id, old.id]);
    expect(await repo.activeIdsForProduct(A, "1", 1)).toEqual([fresh.id]);
    expect(await repo.activeIdsForProduct(A, "99")).toEqual([]);
  });
});
