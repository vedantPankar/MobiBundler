import { beforeEach, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { syncShop, ShopifyUserError, type DiscountGateway } from "../app/bundles/sync.server";
import { MAX_ACTIVE_BUNDLES } from "../app/bundles/config";
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

function fake() {
  const calls: string[] = [];
  const g: DiscountGateway & { calls: string[]; fail?: string; delay?: number } = {
    calls,
    async create() {
      calls.push("create");
      if (g.delay) await new Promise((r) => setTimeout(r, g.delay));
      if (g.fail) throw new ShopifyUserError(g.fail);
      return { discountId: "gid://shopify/DiscountAutomaticNode/1" };
    },
    async update() {
      calls.push("update");
      if (g.fail) throw new ShopifyUserError(g.fail);
    },
    async setActive(_id, a) {
      calls.push(a ? "activate" : "deactivate");
    },
    async inspect() {
      return null;
    },
  };
  return g;
}

let prisma: Awaited<ReturnType<typeof createTestPrisma>>;
let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => {
  prisma = await createTestPrisma();
  await resetTestDb(prisma);
  repo = createBundleRepo(prisma);
});

test("first sync creates one shared discount; same config is a no-op", async () => {
  await repo.create(S, "USD", input("A"));
  await repo.create(S, "USD", input("B", 3, 4));
  const g = fake();
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("created");
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("noop");
  expect(g.calls).toEqual(["create"]);
  expect((await repo.list(S)).every((b) => b.syncStatus === "synced")).toBe(true);
});
test("config change updates the same discount id", async () => {
  await repo.create(S, "USD", input("A"));
  const g = fake();
  await syncShop({ shop: S, prisma, repo, gateway: g });
  await repo.create(S, "USD", input("B", 3, 4));
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("updated");
  expect(g.calls).toEqual(["create", "update"]);
});
test("zero active bundles deactivates, then reactivation updates and activates", async () => {
  const a = await repo.create(S, "USD", input("A"));
  const g = fake();
  await syncShop({ shop: S, prisma, repo, gateway: g });
  await repo.setStatus(S, a.id, "paused");
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("deactivated");
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("noop");
  await repo.setStatus(S, a.id, "active");
  await syncShop({ shop: S, prisma, repo, gateway: g });
  expect(g.calls).toEqual(["create", "deactivate", "activate", "update"]);
});
test("nothing active and no discount yet: noop, no Shopify call", async () => {
  const g = fake();
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("noop");
  expect(g.calls).toEqual([]);
});
test("Shopify userErrors mark bundles error and are retryable", async () => {
  const a = await repo.create(S, "USD", input("A"));
  const g = fake();
  g.fail = "Function not found";
  const r = await syncShop({ shop: S, prisma, repo, gateway: g });
  expect(r.status).toBe("error");
  const b = (await repo.get(S, a.id))!;
  expect(b.syncStatus).toBe("error");
  expect(b.syncError).toContain("Function not found");
  g.fail = undefined;
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("created");
  expect((await repo.get(S, a.id))!.syncStatus).toBe("synced");
});
test("unexpected errors are reported generically and are retryable", async () => {
  await repo.create(S, "USD", input("A"));
  const g = fake();
  g.create = async () => {
    throw new TypeError("boom: secret-ish detail");
  };
  const r = await syncShop({ shop: S, prisma, repo, gateway: g });
  expect(r.status).toBe("error");
  expect(r.message).not.toContain("secret");
});
test("more active bundles than the limit is reported, not sent", async () => {
  for (let i = 0; i < MAX_ACTIVE_BUNDLES + 1; i++) {
    await repo.create(S, "USD", input(`Bundle ${i}`, i * 2 + 1, i * 2 + 2));
  }
  const g = fake();
  const r = await syncShop({ shop: S, prisma, repo, gateway: g });
  expect(r.status).toBe("error");
  expect(r.message).toMatch(/limit/);
  expect(g.calls).toEqual([]);
});
test("sync is scoped per shop", async () => {
  await repo.create("b.myshopify.com", "USD", input("Other"));
  const g = fake();
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("noop");
});
test("concurrent syncs for one shop create the discount only once", async () => {
  await repo.create(S, "USD", input("A"));
  const g = fake();
  g.delay = 30;
  const [r1, r2] = await Promise.all([
    syncShop({ shop: S, prisma, repo, gateway: g }),
    syncShop({ shop: S, prisma, repo, gateway: g }),
  ]);
  expect([r1.status, r2.status].sort()).toEqual(["created", "noop"]);
  expect(g.calls).toEqual(["create"]);
});
