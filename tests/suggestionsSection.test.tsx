import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SuggestionsSection } from "../app/bundles/SuggestionsSection";
import type { Suggestion, SuggestionResult } from "../app/bundles/suggestions.server";

const sug = (over: Partial<Suggestion> = {}): Suggestion => ({
  key: "1|2", variants: [{ variantId: "v1", productId: "p1", title: "Liquid", priceMinor: 74995 }, { variantId: "v2", productId: "p2", title: "Oxygen", priceMinor: 102500 }],
  together: 7, sharePct: 40, lift: 3.2, smallSample: false, listPriceMinor: 177495, discountPct: 10, discountMinor: 17749, bundlePriceMinor: 159746,
  createUrl: "/app/bundles/new?variants=1,2&discount=10", ...over,
});
const res = (over: Partial<SuggestionResult> = {}): SuggestionResult => ({
  generatedAt: "2026-10-25T12:00:00Z", days: 60, orders: 30, multiItemOrders: 12, truncated: false, suggestions: [sug()], ...over,
});
const html = (p: { result: SuggestionResult | null; error?: { code: string; message: string } | null }) =>
  renderToStaticMarkup(<SuggestionsSection currency="USD" result={p.result} error={p.error ?? null} onCreate={() => {}} refreshControl={<button>Refresh suggestions</button>} />);

describe("suggestions page", () => {
  test("order access not approved: the approval banner and no suggestions", () => {
    const h = html({ result: null, error: { code: "ACCESS_NOT_APPROVED", message: "Shopify has not approved this app to read orders yet." } });
    expect(h).toContain("Shopify has not approved order access for this app");
    expect(h).toContain('tone="critical"');
    expect(h).not.toContain("Create this bundle");
  });

  test("another failure is a warning, not an empty list", () => {
    const h = html({ result: null, error: { code: "FAILED", message: "Order sync failed." } });
    expect(h).toContain("Suggestions are unavailable");
    expect(h).toContain('tone="warning"');
  });

  test("no orders in the period is its own message", () => {
    expect(html({ result: res({ orders: 0, multiItemOrders: 0, suggestions: [] }) })).toContain("nothing to suggest yet");
  });

  test("orders exist but no pair repeats: explains what is needed", () => {
    expect(html({ result: res({ suggestions: [] }) })).toContain("bought together at least twice");
  });

  test("a suggestion shows the evidence, the price maths and a create button; it never claims a forecast", () => {
    const h = html({ result: res() });
    expect(h).toContain("Liquid  +  Oxygen");
    expect(h).toContain("Bought together in 7 order(s), 40%");
    expect(h).toContain("3.2× more often than chance");
    expect(h).toContain("list price $1,774.95, bundle price $1,597.46");
    expect(h).toContain("Create this bundle");
    expect(h).toContain("not predictions");
    expect(h).not.toMatch(/will earn|expected revenue|projected/i);
  });

  test("small samples are flagged and weak lift is not advertised", () => {
    const h = html({ result: res({ suggestions: [sug({ smallSample: true, together: 2, lift: 1.1 })] }) });
    expect(h).toContain("Small sample");
    expect(h).not.toContain("more often than chance");
  });

  test("truncated reads are disclosed, and the basis (orders and days) is stated", () => {
    const h = html({ result: res({ truncated: true }) });
    expect(h).toContain("30 most recent order(s) from the last 60 days");
    expect(h).toContain("only the newest were read");
  });
});

describe("dashboard: compact suggestions", () => {
  const compact = { limit: 2, viewAllHref: "/app/suggestions" };
  const chtml = (p: { result: SuggestionResult | null; error?: { code: string; message: string } | null }) =>
    renderToStaticMarkup(<SuggestionsSection currency="USD" result={p.result} error={p.error ?? null} onCreate={() => {}} compact={compact} />);

  test("only the top few, each with a create button, and a link to see all", () => {
    const three = [sug({ key: "1|2" }), sug({ key: "3|4" }), sug({ key: "5|6" })];
    const h = chtml({ result: res({ suggestions: three }) });
    expect((h.match(/Create this bundle/g) ?? []).length).toBe(2);
    expect(h).toContain('href="/app/suggestions"');
    expect(h).toContain("See all suggested bundles");
    expect(h).not.toContain("Generated");
    expect(h).not.toContain("Refresh");
  });

  test("failure and empty states stay short and still link out", () => {
    expect(chtml({ result: null, error: { code: "ACCESS_NOT_APPROVED", message: "Shopify has not approved this app to read orders yet." } })).toContain("Suggestions are unavailable");
    expect(chtml({ result: res({ orders: 0, suggestions: [] }) })).toContain("nothing to suggest yet");
    expect(chtml({ result: res({ suggestions: [] }) })).toContain("at least twice");
    expect(chtml({ result: res({ suggestions: [] }) })).toContain("See all suggested bundles");
  });

  test("small samples are flagged here too", () => {
    expect(chtml({ result: res({ suggestions: [sug({ smallSample: true })] }) })).toContain("Small sample");
  });
});
