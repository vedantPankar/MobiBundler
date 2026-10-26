import { currencyExponent, fromMinor } from "./engine";
import { previewBundle } from "./pricingPreview";
import type { BundleRepo } from "./repo.server";
import { fetchVariantDetails, type CatalogAdmin } from "./shopifyCatalog.server";

export interface PublicBundle {
  id: string;
  name: string;
  buttonLabel: string | null;
  showSavings: boolean;
  currencyCode: string;
  items: {
    variantNumericId: string;
    title: string;
    quantity: number;
    imageUrl: string | null;
    priceMinor: number;
    /** Decimal string for display. */
    price: string;
    inStock: boolean;
  }[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  /** Decimal strings for display, so the storefront never does currency math. */
  subtotal: string;
  discount: string;
  total: string;
}

const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

/**
 * Display data for the theme block. Only ACTIVE bundles of `shop` are returned; any other id (draft, archived,
 * unknown, another shop's) is silently omitted. Prices are informational: checkout is priced by the Function.
 */
export async function getPublicBundles(d: {
  shop: string;
  ids: string[];
  repo: BundleRepo;
  admin: CatalogAdmin;
}): Promise<PublicBundle[]> {
  const out: PublicBundle[] = [];
  for (const id of d.ids.slice(0, 10)) {
    const b = await d.repo.get(d.shop, id);
    if (!b || b.status !== "active") continue;
    const live = await fetchVariantDetails(d.admin, b.items.map((i) => i.variantId));
    if (b.items.some((i) => !live.has(i.variantId))) continue; // a component no longer exists: do not offer it
    const prices = Object.fromEntries(b.items.map((i) => [i.variantId, live.get(i.variantId)!.priceMinor]));
    const p = previewBundle(
      {
        name: b.name,
        status: b.status,
        pricingKind: b.pricingKind,
        pricingValue: b.pricingValue,
        items: b.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
      },
      prices,
    );
    const exp = currencyExponent(b.currencyCode);
    out.push({
      id: b.id,
      name: b.name,
      buttonLabel: b.buttonLabel,
      showSavings: b.showSavings,
      currencyCode: b.currencyCode,
      items: b.items.map((i) => {
        const v = live.get(i.variantId)!;
        return {
          variantNumericId: numericId(i.variantId),
          title: v.variantTitle === "Default Title" ? v.productTitle : `${v.productTitle} – ${v.variantTitle}`,
          quantity: i.quantity,
          imageUrl: v.imageUrl,
          priceMinor: v.priceMinor,
          price: fromMinor(v.priceMinor, exp),
          inStock: v.available === null || v.available > 0,
        };
      }),
      subtotalMinor: p.subtotalMinor,
      discountMinor: p.discountMinor,
      totalMinor: p.totalMinor,
      subtotal: fromMinor(p.subtotalMinor, exp),
      discount: fromMinor(p.discountMinor, exp),
      total: fromMinor(p.totalMinor, exp),
    });
  }
  return out;
}
