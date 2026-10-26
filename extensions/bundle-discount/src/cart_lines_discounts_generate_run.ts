import { DiscountClass, ProductDiscountSelectionStrategy } from "../generated/api";
import type { CartInput, CartLinesDiscountsGenerateRunResult } from "../generated/api";
import { parseSharedConfig } from "./config";
import {
  BUNDLE_DISCOUNT_MESSAGE,
  allocate,
  currencyExponent,
  fromMinor,
  toMinor,
  type BundleEntry,
  type CartLineInput,
} from "./engine";

// Eligibility and amounts come only from the server-written metafield and the cart's own
// variant ids, quantities and prices. Line attributes and client-submitted bundle ids are ignored.
export function buildResult(input: CartInput): CartLinesDiscountsGenerateRunResult {
  const empty = { operations: [] };
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) return empty;
  const bundles = parseSharedConfig(input.discount.metafield?.jsonValue);
  if (bundles.length === 0) return empty;

  const rate = Number(input.presentmentCurrencyRate ?? "1") || 1;
  const currency = input.cart.lines[0]?.cost.amountPerQuantity.currencyCode ?? "USD";
  const exp = currencyExponent(currency);

  const lines: CartLineInput[] = [];
  for (const l of input.cart.lines) {
    if (l.merchandise.__typename !== "ProductVariant") continue;
    lines.push({
      id: l.id,
      variantId: l.merchandise.id,
      quantity: l.quantity,
      unitPriceMinor: toMinor(l.cost.amountPerQuantity.amount, exp),
    });
  }

  // Fixed amounts are stored in shop-currency minor units; convert to presentment currency.
  const entries: BundleEntry[] = bundles.map((b) =>
    b.pricing.kind === "fixed_amount_off"
      ? { ...b, pricing: { ...b.pricing, amountMinor: Math.round(Number(b.pricing.amountMinor) * rate) } }
      : b,
  );

  const allocations = allocate(entries, lines);
  if (allocations.length === 0) return empty;
  return {
    operations: [
      {
        productDiscountsAdd: {
          selectionStrategy: ProductDiscountSelectionStrategy.All,
          candidates: allocations.map((a) => ({
            message: BUNDLE_DISCOUNT_MESSAGE,
            targets: [{ cartLine: { id: a.lineId, quantity: a.quantity } }],
            value: { fixedAmount: { amount: fromMinor(a.discountMinor, exp), appliesToEachItem: false } },
          })),
        },
      },
    ],
  };
}

// Export name must match shopify.extension.toml (`cart-lines-discounts-generate-run`).
export function cartLinesDiscountsGenerateRun(input: CartInput): CartLinesDiscountsGenerateRunResult {
  return buildResult(input);
}
