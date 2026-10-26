import type { ReactNode } from "react";
import { formatMinor } from "./format";
import type { SuggestionResult } from "./suggestions.server";

export interface SuggestionsSectionProps {
  currency: string;
  /** null when orders could not be read. */
  result: SuggestionResult | null;
  error: { code: string; message: string } | null;
  onCreate: (url: string) => void;
  refreshControl?: ReactNode;
  /** Dashboard version: only the top few, no intro, and a link to the full page. */
  compact?: { limit: number; viewAllHref: string };
}

/** Presentation only. Every figure describes past orders; nothing here is a forecast. */
export function SuggestionsSection({ currency, result, error, onCreate, refreshControl, compact }: SuggestionsSectionProps) {
  const money = (m: number) => formatMinor(m, currency);

  if (compact) {
    return (
      <s-section heading="Suggested bundles">
        <s-stack gap="base">
          {error || !result ? (
            <s-paragraph>Suggestions are unavailable: {error?.message ?? "orders could not be read."}</s-paragraph>
          ) : result.suggestions.length === 0 ? (
            <s-paragraph>
              {result.orders === 0
                ? `No orders in the last ${result.days} days, so there is nothing to suggest yet.`
                : "No product pair has been bought together at least twice (and not already bundled) yet."}
            </s-paragraph>
          ) : (
            result.suggestions.slice(0, compact.limit).map((s) => (
              <s-stack key={s.key} gap="small">
                <s-heading>{s.variants.map((v) => v.title).join("  +  ")}</s-heading>
                <s-text>
                  Bought together in {s.together} order(s), {s.sharePct}% of the orders that contained either product. At {s.discountPct}% off:{" "}
                  {money(s.bundlePriceMinor)} (list price {money(s.listPriceMinor)}).
                </s-text>
                {s.smallSample && <s-badge tone="warning">Small sample: fewer than 5 orders</s-badge>}
                <s-button onClick={() => onCreate(s.createUrl)}>Create this bundle</s-button>
              </s-stack>
            ))
          )}
          <s-link href={compact.viewAllHref}>See all suggested bundles</s-link>
        </s-stack>
      </s-section>
    );
  }

  if (error || !result) {
    return (
      <s-section>
        <s-banner tone={error?.code === "FAILED" ? "warning" : "critical"} heading={error?.code === "ACCESS_NOT_APPROVED" ? "Shopify has not approved order access for this app" : "Suggestions are unavailable"}>
          <s-paragraph>{error?.message ?? "Orders could not be read."}</s-paragraph>
        </s-banner>
        {refreshControl}
      </s-section>
    );
  }

  return (
    <>
      <s-section>
        <s-stack gap="small">
          <s-paragraph>
            Based on the {result.orders} most recent order(s) from the last {result.days} days
            {result.truncated ? " (there were more; only the newest were read)" : ""}. {result.multiItemOrders} of them contained two or more different
            products. These are patterns in past orders, not predictions.
          </s-paragraph>
          <s-text>Generated {new Date(result.generatedAt).toLocaleString()}</s-text>
          {refreshControl}
        </s-stack>
      </s-section>

      {result.orders === 0 ? (
        <s-section>
          <s-paragraph>No orders in the last {result.days} days, so there is nothing to suggest yet.</s-paragraph>
        </s-section>
      ) : result.suggestions.length === 0 ? (
        <s-section>
          <s-paragraph>
            No product pair has been bought together at least twice (and not already bundled). Suggestions appear once more orders contain
            two or more products.
          </s-paragraph>
        </s-section>
      ) : (
        result.suggestions.map((s) => (
          <s-section key={s.key} heading={s.variants.map((v) => v.title).join("  +  ")}>
            <s-stack gap="small">
              <s-text>
                Bought together in {s.together} order(s), {s.sharePct}% of the orders that contained either product.
                {s.lift >= 1.5 ? ` They sell together ${s.lift}× more often than chance.` : ""}
              </s-text>
              {s.smallSample && <s-badge tone="warning">Small sample: fewer than 5 orders</s-badge>}
              <s-text>
                At {s.discountPct}% off: list price {money(s.listPriceMinor)}, bundle price {money(s.bundlePriceMinor)} (customer saves{" "}
                {money(s.discountMinor)} per bundle).
              </s-text>
              <s-button onClick={() => onCreate(s.createUrl)}>Create this bundle</s-button>
            </s-stack>
          </s-section>
        ))
      )}
    </>
  );
}
