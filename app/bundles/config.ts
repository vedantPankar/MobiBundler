import { createHash } from "node:crypto";
import type { BundleEntry } from "./engine";
import { getStrategy } from "./strategies";
import type { StoredBundle } from "./types";

// Docs (Metafields for input queries) show `$app:<name>` used for BOTH the discountAutomaticAppCreate write and the
// Function input-query read, so we use the same form. Live behavior is still UNVERIFIED (spec S2). Single constant
// by design; the Function's input query must carry the same string (guarded by tests/namespaceSync.test.ts).
export const CONFIG_NAMESPACE = "$app:bundler";
export const CONFIG_KEY = "function-configuration";
export const MAX_CONFIG_BYTES = 65536;
// Local `shopify app function run` measurements (TypeScript/javy): 20 simultaneously matching bundles cost
// ~4.4M instructions at 10 cart lines, ~7.0M at 30, ~19M at 200 (limit 11M). Not verified live. See README.
export const MAX_ACTIVE_BUNDLES = 20;

export class ConfigTooLargeError extends Error {
  constructor(bytes: number) {
    super(`Bundle configuration is ${bytes} bytes; the limit is 64 KB. Archive or simplify bundles.`);
  }
}

export class TooManyBundlesError extends Error {
  constructor(count: number) {
    super(`${count} active bundles; the v1 limit is ${MAX_ACTIVE_BUNDLES}. Pause or archive some bundles.`);
  }
}

export function buildSharedConfig(bundles: StoredBundle[]): { v: 1; bundles: BundleEntry[] } {
  const sorted = [...bundles].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { v: 1, bundles: sorted.map((b) => getStrategy(b.type).toSharedEntry(b)) };
}

export const hashConfigJson = (json: string) => createHash("sha256").update(json).digest("hex");

export function serializeSharedConfig(bundles: StoredBundle[]): { json: string; hash: string } {
  if (bundles.length > MAX_ACTIVE_BUNDLES) throw new TooManyBundlesError(bundles.length);
  const json = JSON.stringify(buildSharedConfig(bundles));
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_CONFIG_BYTES) throw new ConfigTooLargeError(bytes);
  return { json, hash: hashConfigJson(json) };
}

/** Title of the shared automatic discount in the admin. It is NOT what orders record: see BUNDLE_DISCOUNT_MESSAGE. */
export const BUNDLE_DISCOUNT_TITLE = "MobiBundler bundles";
