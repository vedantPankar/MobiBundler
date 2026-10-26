/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted/loosely-typed Function input */
import type { BundleEntry } from "./engine";

export const CONFIG_VERSION = 1;

function isEntry(x: unknown): x is BundleEntry {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, any>;
  return (
    typeof b.id === "string" &&
    !!b.pricing &&
    typeof b.pricing.kind === "string" &&
    Array.isArray(b.items) &&
    b.items.every(
      (i: any) => i && typeof i.variantId === "string" && typeof i.quantity === "number",
    )
  );
}

/** Fails safe: anything unrecognised (wrong version, wrong shape) yields no bundles, never an error. */
export function parseSharedConfig(raw: unknown): BundleEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const c = raw as Record<string, unknown>;
  if (c.v !== CONFIG_VERSION || !Array.isArray(c.bundles)) return [];
  return c.bundles.filter(isEntry);
}
