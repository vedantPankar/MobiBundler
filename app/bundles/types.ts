export type BundleStatus = "draft" | "active" | "paused" | "archived";
export type PricingKind = "percentage" | "fixed_amount_off";

export interface BundleItemInput {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface BundleInput {
  name: string;
  description?: string;
  status: BundleStatus;
  pricingKind: PricingKind;
  pricingValue: number;
  /** Storefront presentation (display only; never affects discount math). */
  buttonLabel?: string;
  showSavings?: boolean;
  items: BundleItemInput[];
}

export interface StoredBundle {
  id: string;
  shop: string;
  name: string;
  description: string | null;
  type: string;
  status: BundleStatus;
  pricingKind: PricingKind;
  pricingValue: number;
  currencyCode: string;
  buttonLabel: string | null;
  showSavings: boolean;
  syncStatus: string;
  syncError: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  items: (BundleItemInput & { id: string; position: number })[];
}
