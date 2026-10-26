import type { PrismaClient } from "@prisma/client";
import {
  MAX_ACTIVE_BUNDLES,
  MAX_CONFIG_BYTES,
  hashConfigJson,
  serializeSharedConfig,
} from "./config";
import type { BundleRepo } from "./repo.server";
import type { DiscountGateway } from "./sync.server";

export interface DiagnosticItem {
  level: "ok" | "warning" | "critical";
  code: string;
  message: string;
}

const REQUIRED_SCOPES = ["write_discounts", "write_app_proxy"];

/** Key-order-independent form, so Shopify re-serialising stored JSON does not look like drift. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, x]) => [k, canonical(x)]),
    );
  }
  return v;
}
const canonicalHash = (json: string) => {
  try {
    return hashConfigJson(JSON.stringify(canonical(JSON.parse(json))));
  } catch {
    return null;
  }
};

export async function runDiagnostics(d: {
  shop: string;
  repo: BundleRepo;
  prisma: PrismaClient;
  gateway: DiscountGateway;
  fetchVariants: (ids: string[]) => Promise<Map<string, unknown>>;
  grantedScopes: string[];
}): Promise<DiagnosticItem[]> {
  const items: DiagnosticItem[] = [];
  const add = (level: DiagnosticItem["level"], code: string, message: string) => items.push({ level, code, message });

  const missing = REQUIRED_SCOPES.filter((s) => !d.grantedScopes.includes(s));
  if (missing.length > 0) {
    add("critical", "SCOPE_MISSING", `The app has not been granted: ${missing.join(", ")}. Reinstall or re-approve the app.`);
  }

  const all = await d.repo.list(d.shop);
  const active = all.filter((b) => b.status === "active");

  for (const b of all.filter((x) => x.syncStatus === "error")) {
    add("critical", "SYNC_ERROR", `“${b.name}” failed to sync: ${b.syncError ?? "unknown error"}`);
  }

  if (active.length > 0) {
    // Shared discount present, active, and carrying the current configuration?
    const row = await d.prisma.shopDiscount.findUnique({ where: { shop: d.shop } });
    const node = row?.shopifyDiscountId ? await d.gateway.inspect(row.shopifyDiscountId) : null;
    if (!row?.shopifyDiscountId || !node) {
      add("critical", "DISCOUNT_MISSING", "The shared bundle discount does not exist in Shopify. Re-sync to recreate it.");
    } else {
      if (node.status !== "ACTIVE") {
        add("critical", "DISCOUNT_INACTIVE", `The shared bundle discount is ${node.status.toLowerCase()}, so no bundle discounts apply. Re-sync to reactivate it.`);
      }
      try {
        const expected = canonicalHash(serializeSharedConfig(active).json);
        const actual = node.configJson ? canonicalHash(node.configJson) : null;
        if (expected !== actual) {
          add("warning", "CONFIG_DRIFT", "The configuration stored in Shopify differs from your saved bundles. Re-sync to update it.");
        }
      } catch {
        /* over-limit configs are reported by CONFIG_BUDGET below */
      }
    }

    // Components that no longer exist.
    const ids = [...new Set(active.flatMap((b) => b.items.map((i) => i.variantId)))];
    const live = await d.fetchVariants(ids);
    for (const b of active) {
      if (b.items.some((i) => !live.has(i.variantId))) {
        add("critical", "VARIANT_MISSING", `“${b.name}” contains a product or variant that no longer exists. Edit or pause it.`);
      }
    }

    // Variants shared by more than one active bundle.
    const seen = new Map<string, string[]>();
    for (const b of active) for (const i of b.items) seen.set(i.variantId, [...(seen.get(i.variantId) ?? []), b.name]);
    const overlapping = [...new Set([...seen.values()].filter((n) => n.length > 1).flat())];
    if (overlapping.length > 0) {
      add("warning", "OVERLAP", `These bundles share products: ${overlapping.map((n) => `“${n}”`).join(", ")}. Each unit is discounted by one bundle only (the highest saving).`);
    }

    // Budgets.
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(serializeSharedConfig(active).json);
    } catch {
      bytes = MAX_CONFIG_BYTES; // over a limit: treated as full
    }
    const usage = Math.max(bytes / MAX_CONFIG_BYTES, active.length / MAX_ACTIVE_BUNDLES);
    if (usage > 0.8) {
      add("warning", "CONFIG_BUDGET", `Using ${Math.round(usage * 100)}% of the bundle configuration budget (${active.length}/${MAX_ACTIVE_BUNDLES} active bundles).`);
    }
  }

  if (items.length === 0) add("ok", "ALL_OK", "No problems found.");
  return items;
}
