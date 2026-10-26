import { useEffect, useMemo, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { currencyExponent, fromMinor, toMinor } from "./engine";
import { formatMinor } from "./format";
import { Icon } from "./KpiTile";
import { previewBundle } from "./pricingPreview";
import type { BundleInput, BundleStatus, PricingKind } from "./types";
import type { CatalogProduct } from "./shopifyCatalog.server";
import type { SaveResult } from "./save.server";

export interface FormItem {
  productId: string;
  variantId: string;
  quantity: number;
  label: string;
  priceMinor: number;
  available: number | null;
  imageUrl?: string | null;
  missing?: boolean;
}

export interface BundleFormInitial {
  name: string;
  description: string;
  status: BundleStatus;
  pricingKind: PricingKind;
  pricingValue: number;
  buttonLabel: string;
  showSavings: boolean;
  items: FormItem[];
}

const money = (minor: number, currency: string) => {
  const exp = currencyExponent(currency);
  return `${fromMinor(minor, exp)} ${currency}`;
};

export function BundleForm(props: {
  initial: BundleFormInitial;
  currencyCode: string;
  version?: number;
  sharedVariantWarning: boolean;
  syncError?: string | null;
  storefrontUrl?: string | null;
}) {
  const { initial, currencyCode } = props;
  const exp = currencyExponent(currencyCode);
  const navigate = useNavigate();
  const saver = useFetcher<SaveResult>();
  const search = useFetcher<{ products: CatalogProduct[]; error?: string }>();

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [status, setStatus] = useState<BundleStatus>(initial.status);
  const [pricingKind, setPricingKind] = useState<PricingKind>(initial.pricingKind);
  const [pricingText, setPricingText] = useState(
    initial.pricingValue === 0
      ? ""
      : initial.pricingKind === "percentage"
        ? String(initial.pricingValue / 100)
        : fromMinor(initial.pricingValue, exp),
  );
  const [buttonLabel, setButtonLabel] = useState(initial.buttonLabel);
  const [showSavings, setShowSavings] = useState(initial.showSavings);
  const [items, setItems] = useState<FormItem[]>(initial.items);
  const [term, setTerm] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");

  useEffect(() => {
    const t = setTimeout(() => search.load(`/app/products/search?q=${encodeURIComponent(term)}`), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `search` identity changes every render
  }, [term]);

  const parsed = useMemo(() => {
    const t = pricingText.trim();
    if (pricingKind === "percentage") {
      if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
      return Math.round(parseFloat(t) * 100);
    }
    const re = new RegExp(`^\\d+(\\.\\d{1,${exp}})?$`);
    if (!re.test(t) && !(exp === 0 && /^\d+$/.test(t))) return null;
    return toMinor(t, exp);
  }, [pricingText, pricingKind, exp]);

  const input: BundleInput = {
    name,
    description: description || undefined,
    status,
    pricingKind,
    pricingValue: parsed ?? 0,
    buttonLabel: buttonLabel || undefined,
    showSavings,
    items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
  };
  const prices = Object.fromEntries(items.map((i) => [i.variantId, i.priceMinor]));
  const preview = items.length >= 2 && parsed ? previewBundle(input, prices) : null;

  const result = saver.data;
  const errors = result && !result.ok ? result.fieldErrors : {};
  const busy = saver.state !== "idle";
  const localErrors: Record<string, string> = {};
  if (!name.trim()) localErrors.name = "Enter a bundle name.";
  if (parsed === null && pricingText) localErrors.pricingValue = "Enter a valid number.";
  else if (!pricingText.trim()) localErrors.pricingValue = "Enter a discount value.";
  else if (pricingKind === "percentage" && parsed !== null && (parsed < 1 || parsed > 10000)) {
    localErrors.pricingValue = "Percentage must be between 0.01 and 100.";
  }
  if (items.length < 2) localErrors.items = "Select at least two products: search above, then choose Add variant.";
  // Errors the user has not been shown yet stay hidden until they try to save.
  const shownLocal = attempted ? localErrors : {};
  const serverErrors = errors as Record<string, string>;
  const problems = [...new Set([...Object.values(shownLocal), ...Object.values(serverErrors)])];

  const addVariant = (p: CatalogProduct, v: CatalogProduct["variants"][number]) => {
    if (items.some((i) => i.variantId === v.id) || items.length >= 10) return;
    setItems([
      ...items,
      {
        productId: p.id,
        variantId: v.id,
        quantity: 1,
        label: v.title === "Default Title" ? p.title : `${p.title} – ${v.title}`,
        priceMinor: v.priceMinor,
        available: v.available,
        imageUrl: p.imageUrl,
      },
    ]);
  };

  useEffect(() => {
    if (result && !result.ok) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [result]);

  const submit = () => {
    setAttempted(true);
    if (Object.keys(localErrors).length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    saver.submit(
      JSON.stringify({ ...input, ...(props.version ? { _version: props.version } : {}) }),
      { method: "post", encType: "application/json" },
    );
  };

  return (
    <>
      {problems.length > 0 && (
        <s-banner tone="critical" heading="Fix the following before saving">
          <s-stack gap="small-300">
            {problems.map((m) => (
              <s-paragraph key={m}>{m}</s-paragraph>
            ))}
          </s-stack>
        </s-banner>
      )}
      {result?.ok && result.syncMessage && (
        <s-banner tone="warning" heading="Saved, but not synced to Shopify">
          <s-paragraph>{result.syncMessage}</s-paragraph>
        </s-banner>
      )}
      {result && !result.ok && result.message && <s-banner tone="critical">{result.message}</s-banner>}
      {props.syncError && (
        <s-banner tone="critical" heading="Last sync failed">
          <s-paragraph>{props.syncError}</s-paragraph>
          <s-button
            onClick={() => saver.submit({ intent: "resync" }, { method: "post" })}
            {...(busy ? { loading: true } : {})}
          >
            Retry sync
          </s-button>
        </s-banner>
      )}
      {items.some((i) => i.missing) && (
        <s-banner tone="critical" heading="Some products no longer exist">
          <s-paragraph>Remove the unavailable variants below before activating this bundle.</s-paragraph>
        </s-banner>
      )}
      {props.sharedVariantWarning && (
        <s-banner tone="warning">
          These products are in another active bundle; each unit is discounted by only one bundle (the highest saving
          applies).
        </s-banner>
      )}

      <div className="mb-edithead">
        <div>
          <span className={initial.status === "active" ? "mb-pill" : "mb-pill mb-pill--grey"}>{initial.status}</span>
          <span className="mb-row__sub"> Create and manage your product bundle.</span>
        </div>
        <s-stack direction="inline" gap="base">
          {props.storefrontUrl && (
            <s-button href={props.storefrontUrl} target="_blank">
              View on storefront
            </s-button>
          )}
          <s-button variant="primary" onClick={submit} {...(busy ? { loading: true } : {})}>
            Save bundle
          </s-button>
        </s-stack>
      </div>
      <div className="mb-edit">
        <div className="mb-main">
      <section className="mb-card"><div className="mb-card__head"><span className="mb-step">1</span><h3 className="mb-card__title">General</h3></div>
        <s-stack gap="base">
          <s-text-field
            label="Bundle name"
            value={name}
            error={errors.name ?? shownLocal.name}
            onInput={(e: Event) => setName((e.currentTarget as HTMLInputElement).value)}
          />
          <s-text-area
            label="Description (optional)"
            value={description}
            onInput={(e: Event) => setDescription((e.currentTarget as HTMLTextAreaElement).value)}
          />
          <s-select
            label="Status"
            value={status}
            onChange={(e: Event) => setStatus((e.currentTarget as HTMLSelectElement).value as BundleStatus)}
          >
            <s-option value="draft">Draft</s-option>
            <s-option value="active">Active</s-option>
            <s-option value="paused">Paused</s-option>
            <s-option value="archived">Archived</s-option>
          </s-select>
        </s-stack>
      </section>

      <section className="mb-card"><div className="mb-card__head"><span className="mb-step">2</span><h3 className="mb-card__title">Products <span className="mb-row__sub">({items.length} selected)</span></h3></div>
        <s-stack gap="base">
          <s-button commandFor="product-picker">Add products</s-button>
          <s-modal id="product-picker" heading="Add products">
            <s-stack gap="base">
          <s-search-field
            label="Search products"
            labelAccessibilityVisibility="exclusive"
            placeholder="Search products by title"
            value={term}
            onInput={(e: Event) => setTerm((e.currentTarget as HTMLInputElement).value)}
          />
          {search.state !== "idle" && <s-spinner accessibilityLabel="Searching products" />}
          {search.data?.error && search.state === "idle" && (
            <s-banner tone="critical">{search.data.error} Check the app server log for details.</s-banner>
          )}
          {search.data && !search.data.error && search.data.products.length === 0 && search.state === "idle" && (
            <s-paragraph>No active products found.</s-paragraph>
          )}
          <div className="mb-pick">
            {search.data?.products.map((p) => (
              <div key={p.id} className="mb-pick__product">
                <div className="mb-pick__head">
                  <span className="mb-thumb">{p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <Icon name="box" tone="grey" />}</span>
                  <div className="mb-row__main">
                    <div className="mb-row__name">{p.title}</div>
                    <div className="mb-row__sub">{p.variants.length} variant{p.variants.length === 1 ? "" : "s"}</div>
                  </div>
                </div>
                {p.variants.map((v) => {
                  const added = items.some((i) => i.variantId === v.id);
                  const out = v.available !== null && v.available <= 0;
                  return (
                    <div key={v.id} className="mb-pick__variant">
                      <div className="mb-row__main">
                        <div className="mb-pick__vname">{v.title === "Default Title" ? "Default" : v.title}</div>
                        <div className="mb-row__sub">{formatMinor(v.priceMinor, currencyCode)}</div>
                      </div>
                      <span className={out ? "mb-pill mb-pill--amber" : "mb-pill mb-pill--grey"}>
                        {out ? "Out of stock" : v.available !== null ? `${v.available} in stock` : "Stock not tracked"}
                      </span>
                      <s-button
                        variant={added ? "secondary" : "primary"}
                        onClick={() => addVariant(p, v)}
                        {...(added || items.length >= 10 ? { disabled: true } : {})}
                      >
                        {added ? "Added ✓" : "Add"}
                      </s-button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
            </s-stack>
            <s-button slot="primary-action" variant="primary" commandFor="product-picker" command="--hide">
              Done ({items.length} selected)
            </s-button>
          </s-modal>

          {items.length === 0 && <s-paragraph>No products selected. A bundle needs at least two variants.</s-paragraph>}
          {items.map((i) => (
            <div key={i.variantId} className="mb-sel">
              <span className="mb-thumb">{i.imageUrl ? <img src={i.imageUrl} alt="" loading="lazy" /> : <Icon name="box" tone="grey" />}</span>
              <div className="mb-row__main">
                <div className="mb-row__name">{i.label}</div>
                <div className="mb-row__sub">{formatMinor(i.priceMinor, currencyCode)}</div>
              </div>
              {i.missing ? (
                <span className="mb-pill mb-pill--amber">Unavailable</span>
              ) : i.available !== null && i.available <= 0 ? (
                <span className="mb-pill mb-pill--amber">Out of stock</span>
              ) : (
                <span className="mb-pill">Selected</span>
              )}
              <s-number-field
                label={`Quantity for ${i.label}`}
                labelAccessibilityVisibility="exclusive"
                min={1}
                max={99}
                step={1}
                value={String(i.quantity)}
                onInput={(e: Event) => {
                  const q = Math.max(1, Math.min(99, parseInt((e.currentTarget as HTMLInputElement).value, 10) || 1));
                  setItems(items.map((x) => (x.variantId === i.variantId ? { ...x, quantity: q } : x)));
                }}
              />
              <s-button variant="tertiary" tone="critical" onClick={() => setItems(items.filter((x) => x.variantId !== i.variantId))}>
                Remove
              </s-button>
            </div>
          ))}
        </s-stack>
      </section>

      <section className="mb-card"><div className="mb-card__head"><span className="mb-step">3</span><h3 className="mb-card__title">Discount</h3></div>
        <s-stack gap="base">
          <s-select
            label="Discount type"
            value={pricingKind}
            onChange={(e: Event) => {
              setPricingKind((e.currentTarget as HTMLSelectElement).value as PricingKind);
              setPricingText("");
            }}
          >
            <s-option value="percentage">Percentage off the bundle</s-option>
            <s-option value="fixed_amount_off">Fixed amount off the bundle</s-option>
          </s-select>
          <s-text-field
            label={pricingKind === "percentage" ? "Percentage (0.01–100)" : `Amount off (${currencyCode})`}
            value={pricingText}
            error={errors.pricingValue ?? shownLocal.pricingValue}
            onInput={(e: Event) => setPricingText((e.currentTarget as HTMLInputElement).value)}
          />
        </s-stack>
      </section>

      <section className="mb-card"><div className="mb-card__head"><span className="mb-step">4</span><h3 className="mb-card__title">Storefront display</h3></div>
        <s-stack gap="base">
          <s-text-field
            label="Button label"
            details="Shown on the add-to-cart button. Leave empty for the default."
            value={buttonLabel}
            maxLength={40}
            error={errors.buttonLabel}
            onInput={(e: Event) => setButtonLabel((e.currentTarget as HTMLInputElement).value)}
          />
          <s-checkbox
            label="Show savings on the product page"
            {...(showSavings ? { checked: true } : {})}
            onChange={(e: Event) => setShowSavings((e.currentTarget as HTMLInputElement).checked)}
          />
        </s-stack>
      </section>

              </div>
        <div className="mb-side">
          <section className="mb-card">
            <div className="mb-card__head">
              <Icon name="eye" />
              <h3 className="mb-card__title">Bundle preview</h3>
              <span className="mb-toggle" role="group" aria-label="Preview size">
                <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>Mobile</button>
                <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>Desktop</button>
              </span>
            </div>
            <div className={`mb-phone mb-phone--${device}`}>
              <div className="mb-phone__bar">{name.trim() || "Your store"}</div>
              {items.length === 0 ? (
                <div className="mb-row__sub">Select products to see the bundle.</div>
              ) : (
                <div className="mb-pv__items">
                  {items.map((i, n) => (
                    <span key={i.variantId} className="mb-pv__group">
                      {n > 0 && <span className="mb-pv__plus">+</span>}
                      <span className="mb-pv__item">
                        {i.imageUrl && <img className="mb-pv__img" src={i.imageUrl} alt="" />}
                        <span className="mb-pv__name">{i.label}{i.quantity > 1 ? ` ×${i.quantity}` : ""}</span>
                        <span className="mb-row__sub">{formatMinor(i.priceMinor, currencyCode)}</span>
                      </span>
                    </span>
                  ))}
                </div>
              )}
              <div className="mb-pv__title">{name.trim() || "Bundle name"}</div>
              {preview ? (
                <div className="mb-pv__prices">
                  {preview.discountMinor > 0 && <s>{formatMinor(preview.subtotalMinor, currencyCode)}</s>}
                  <b>{formatMinor(preview.totalMinor, currencyCode)}</b>
                  {showSavings && preview.discountMinor > 0 && <span className="mb-pill">Save {formatMinor(preview.discountMinor, currencyCode)}</span>}
                </div>
              ) : (
                <div className="mb-row__sub">Add two products and a discount to see prices.</div>
              )}
              <div className="mb-pv__btn">{buttonLabel.trim() || "Add bundle to cart"}</div>
            </div>
            <div className="mb-row__sub">Approximate. Your theme controls fonts and spacing on the live page.</div>
          </section>

          <section className="mb-card">
            <div className="mb-card__head">
              <Icon name="percent" />
              <h3 className="mb-card__title">Bundle price</h3>
            </div>
            {preview ? (
              <>
                <div className="mb-kv"><span>Original price</span><b>{formatMinor(preview.subtotalMinor, currencyCode)}</b></div>
                <div className="mb-kv"><span>Bundle discount</span><b className="mb-neg">−{formatMinor(preview.discountMinor, currencyCode)}</b></div>
                <div className="mb-kv mb-kv--total"><span>Bundle price</span><b>{formatMinor(preview.totalMinor, currencyCode)}</b></div>
                <div className="mb-save">You save {formatMinor(preview.discountMinor, currencyCode)}{preview.subtotalMinor > 0 ? ` (${Math.round((preview.discountMinor / preview.subtotalMinor) * 100)}%)` : ""}</div>
                <div className="mb-row__sub">Preview only. The discount is calculated again at checkout from your cart and this saved configuration.</div>
              </>
            ) : (
              <s-paragraph>Select two or more products and enter a discount to see a preview.</s-paragraph>
            )}
          </section>
        </div>
      </div>

      <s-stack direction="inline" gap="base">
        <s-button variant="primary" onClick={submit} {...(busy ? { loading: true } : {})}>
          Save bundle
        </s-button>
        <s-button onClick={() => navigate("/app/bundles")}>Cancel</s-button>
      </s-stack>
    </>
  );
}
