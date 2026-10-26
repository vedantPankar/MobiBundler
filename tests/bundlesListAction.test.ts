import { beforeEach, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { runBundleAction } from "../app/bundles/actions.server";
import { createTestPrisma, resetTestDb } from "./testDb";

const A = "a.myshopify.com";
const B = "b.myshopify.com";
const input = (name: string) => ({
  name,
  status: "draft" as const,
  pricingKind: "percentage" as const,
  pricingValue: 1000,
  items: [
    { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 },
    { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 1 },
  ],
});
let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => {
  const p = await createTestPrisma();
  await resetTestDb(p);
  repo = createBundleRepo(p);
});
const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) [v].flat().forEach((x) => f.append(k, x));
  return f;
};

test("bulk activate then sync once", async () => {
  const a = await repo.create(A, "USD", input("A"));
  const b = await repo.create(A, "USD", input("B"));
  const sync = vi.fn(async () => ({ status: "created" }));
  const r = await runBundleAction({ shop: A, repo, sync }, form({ intent: "activate", ids: [a.id, b.id] }));
  expect(r.ok).toBe(true);
  expect(sync).toHaveBeenCalledTimes(1);
  expect((await repo.list(A)).every((x) => x.status === "active")).toBe(true);
});
test("cannot act on another shop's bundles", async () => {
  const other = await repo.create(B, "USD", input("Other"));
  const sync = vi.fn(async () => ({ status: "noop" }));
  await runBundleAction({ shop: A, repo, sync }, form({ intent: "archive", ids: [other.id] }));
  expect((await repo.get(B, other.id))!.status).toBe("draft");
});
test("duplicate and unknown intent", async () => {
  const a = await repo.create(A, "USD", input("A"));
  const sync = vi.fn(async () => ({ status: "noop" }));
  expect((await runBundleAction({ shop: A, repo, sync }, form({ intent: "duplicate", ids: [a.id] }))).ok).toBe(true);
  expect(await repo.list(A)).toHaveLength(2);
  expect((await runBundleAction({ shop: A, repo, sync }, form({ intent: "explode", ids: [a.id] }))).ok).toBe(false);
});
test("no selection is rejected without side effects", async () => {
  const sync = vi.fn(async () => ({ status: "noop" }));
  expect((await runBundleAction({ shop: A, repo, sync }, form({ intent: "activate" }))).ok).toBe(false);
  expect(sync).not.toHaveBeenCalled();
});
test("sync error is surfaced", async () => {
  const a = await repo.create(A, "USD", input("A"));
  const r = await runBundleAction(
    { shop: A, repo, sync: async () => ({ status: "error", message: "boom" }) },
    form({ intent: "activate", ids: [a.id] }),
  );
  expect(r.ok).toBe(false);
  expect(r.message).toContain("boom");
});
test("event recording is ownership-checked, idempotent per shop+dedupeKey and counted", async () => {
  const mine = await repo.create(A, "USD", input("A"));
  const theirs = await repo.create(B, "USD", input("B"));
  expect(await repo.recordEvent(A, mine.id, "view", "k1")).toBe("recorded");
  expect(await repo.recordEvent(A, mine.id, "view", "k1")).toBe("duplicate");
  expect(await repo.recordEvent(A, theirs.id, "view", "k9")).toBe("ignored");
  expect(await repo.recordEvent(B, theirs.id, "view", "k1")).toBe("recorded");
  await repo.recordEvent(A, mine.id, "add_to_cart", "k2");
  expect(await repo.eventCounts(A)).toEqual({ view: 1, add_to_cart: 1 });
});
