import { allocate } from "./engine";
import type { BundleInput } from "./types";

// Uses the same engine as the Function, so the admin preview matches checkout math. Display only.
export function previewBundle(input: BundleInput, prices: Record<string, number>) {
  const lines = input.items.map((i, n) => ({
    id: `p${n}`,
    variantId: i.variantId,
    quantity: i.quantity,
    unitPriceMinor: prices[i.variantId] ?? 0,
  }));
  const subtotalMinor = lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
  const pricing =
    input.pricingKind === "percentage"
      ? { kind: "percentage", basisPoints: input.pricingValue }
      : { kind: "fixed_amount_off", amountMinor: input.pricingValue };
  const alloc = allocate(
    [{ id: "preview", pricing, items: input.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })) }],
    lines,
  );
  const discountMinor = alloc.reduce((s, a) => s + a.discountMinor, 0);
  return { subtotalMinor, discountMinor, totalMinor: subtotalMinor - discountMinor };
}
