import { createHmac } from "node:crypto";
import { beforeAll, expect, test, vi } from "vitest";
import { createTestPrisma } from "./testDb";

// Exercises the REAL authenticate.webhook from @shopify/shopify-app-react-router with a test secret, so the app's
// own configuration (secret handling, header names) is covered. Only the database is swapped for the test one.
// Shopify's servers are not involved: this proves the verification wiring, not what Shopify will send.
const SECRET = "test-secret-not-a-real-one";
const state = vi.hoisted(() => ({ prisma: null as unknown }));
vi.mock("../app/db.server", () => ({
  default: new Proxy({}, { get: (_t, k) => (state.prisma as Record<string | symbol, unknown>)[k] }),
}));

let authenticate: typeof import("../app/shopify.server").authenticate;
beforeAll(async () => {
  state.prisma = await createTestPrisma();
  vi.stubEnv("SHOPIFY_API_KEY", "test-key");
  vi.stubEnv("SHOPIFY_API_SECRET", SECRET);
  vi.stubEnv("SHOPIFY_APP_URL", "https://example.com");
  vi.stubEnv("SCOPES", "read_products");
  ({ authenticate } = await import("../app/shopify.server"));
});

const body = JSON.stringify({ id: 1001 });
const sign = (b: string, secret = SECRET) => createHmac("sha256", secret).update(b, "utf8").digest("base64");
const req = (hmac: string, b = body) =>
  new Request("https://example.com/webhooks/orders", {
    method: "POST",
    body: b,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-Topic": "orders/paid",
      "X-Shopify-Shop-Domain": "a.myshopify.com",
      "X-Shopify-API-Version": "2026-07",
      "X-Shopify-Webhook-Id": "w1",
    },
  });

test("a correctly signed webhook is accepted and exposes shop, topic and payload", async () => {
  const r = await authenticate.webhook(req(sign(body)));
  expect(r.shop).toBe("a.myshopify.com");
  expect(r.topic).toBe("ORDERS_PAID");
  expect(r.payload).toEqual({ id: 1001 });
});

const statusOf = async (request: Request) => {
  try {
    await authenticate.webhook(request);
    return 200;
  } catch (e) {
    return (e as Response).status;
  }
};

test("a wrong signature and a tampered body are rejected with 401", async () => {
  expect(await statusOf(req(sign(body, "other-secret")))).toBe(401);
  expect(await statusOf(req(sign(body), JSON.stringify({ id: 9999 })))).toBe(401);
});

test("a request with no signature is rejected (the library answers 400, not 200)", async () => {
  const status = await statusOf(req(""));
  expect([400, 401]).toContain(status);
});
