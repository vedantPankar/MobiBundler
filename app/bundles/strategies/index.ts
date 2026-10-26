import { fixedStrategy, type BundleStrategy } from "./fixed";

const registry: Record<string, BundleStrategy> = { fixed: fixedStrategy };

// Future types (mix_and_match, volume, bxgy, fbt, tiered) register here; fixed_price is a new pricing kind.
export function getStrategy(key: string): BundleStrategy {
  const s = registry[key];
  if (!s) throw new Error(`Unknown bundle type: ${key}`);
  return s;
}
export type { BundleStrategy };
