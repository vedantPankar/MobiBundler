import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { CONFIG_KEY, CONFIG_NAMESPACE } from "../app/bundles/config";

// The app writes the metafield with CONFIG_NAMESPACE/CONFIG_KEY; the Function reads it by the literal strings in
// its input query. If they drift, discounts silently stop applying, so guard them.
test("Function input query reads the same namespace/key the app writes", () => {
  const q = readFileSync("extensions/bundle-discount/src/cart_lines_discounts_generate_run.graphql", "utf8");
  expect(q).toContain(`metafield(namespace: "${CONFIG_NAMESPACE}", key: "${CONFIG_KEY}")`);
});
test("app.toml requests exactly the scopes the app needs", () => {
  const t = readFileSync("shopify.app.toml", "utf8");
  expect(t).toContain('scopes = "read_products,write_discounts,write_app_proxy,read_orders"');
});
