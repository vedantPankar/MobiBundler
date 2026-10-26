import type { BundleEntry } from "../engine";
import { parseBundleInput } from "../validation";
import type { BundleInput, StoredBundle } from "../types";

export interface BundleStrategy {
  key: string;
  validate(input: unknown): BundleInput;
  toSharedEntry(bundle: StoredBundle): BundleEntry;
}

export const fixedStrategy: BundleStrategy = {
  key: "fixed",
  validate: parseBundleInput,
  toSharedEntry(b) {
    const pricing =
      b.pricingKind === "percentage"
        ? { kind: "percentage", basisPoints: b.pricingValue }
        : { kind: "fixed_amount_off", amountMinor: b.pricingValue };
    return {
      id: b.id,
      pricing,
      items: [...b.items]
        .sort((x, y) => x.position - y.position)
        .map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    };
  },
};
