import { currencyExponent } from "./engine";

export const discountLabel = (b: { pricingKind: string; pricingValue: number; currencyCode: string }) =>
  b.pricingKind === "percentage"
    ? `${b.pricingValue / 100}% off`
    : `${(b.pricingValue / 100).toFixed(2)} ${b.currencyCode} off`;

/** Integer minor units to a display string in that currency (no float money maths). */
export function formatMinor(minor: number, currency: string, locale?: string): string {
  const exp = currencyExponent(currency);
  const n = minor / 10 ** exp;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(exp)} ${currency}`;
  }
}
