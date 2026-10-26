import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BRAND, BRAND_CSS, LOGO_SRC } from "../app/bundles/brand";
import { BrandHeader, KpiGrid } from "../app/bundles/KpiTile";
import { RevenueBars } from "../app/bundles/AnalyticsSection";
import { RevenueSection } from "../app/bundles/RevenueSection";
import { summarizeRevenue } from "../app/bundles/revenueSummary";

// WCAG contrast, computed here so a colour change that hurts legibility fails a test instead of shipping.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("brand colours are legible", () => {
  test("text pairs meet 4.5:1 (normal text) in light and dark", () => {
    const pairs: [string, string, string][] = [
      ["white button text on deep teal", "#ffffff", BRAND.deepTeal],
      ["deep teal accent text on a light card", BRAND.deepTeal, BRAND.paper],
      ["deep teal on white", BRAND.deepTeal, "#ffffff"],
      ["mint accent on the dark card", BRAND.mint, "#1f2726"],
      ["mint on the logo charcoal", BRAND.mint, BRAND.charcoal],
      ["ink on light card", "#0b0b0b", BRAND.paper],
      ["secondary ink on light card", "#52514e", BRAND.paper],
      ["ink on dark card", "#f0efec", "#1f2726"],
      ["secondary ink on dark card", "#c3c2b7", "#1f2726"],
    ];
    for (const [name, fg, bg] of pairs) expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(4.5);
  });

  test("chart bars meet 3:1 against their surfaces (graphical objects)", () => {
    expect(contrast(BRAND.teal, "#fcfcfb")).toBeGreaterThanOrEqual(3);
    expect(contrast(BRAND.brightTeal, "#1a1a19")).toBeGreaterThanOrEqual(3);
  });

  test("the tokens are the colours sampled from the logo", () => {
    expect(BRAND).toMatchObject({ deepTeal: "#02736a", teal: "#029886", brightTeal: "#03ad90", mint: "#75eac7", charcoal: "#252c2c" });
  });
});

describe("where the brand is applied", () => {
  test("the chart uses the brand teal in light and dark, not the old blue", () => {
    const h = renderToStaticMarkup(<RevenueBars daily={[{ date: "2026-10-24", netMinor: 100, orders: 1 }]} currency="USD" />);
    expect(h).toContain(`--bar:${BRAND.teal}`);
    expect(h).toContain(`--bar:${BRAND.brightTeal}`);
    expect(h).not.toMatch(/#2a78d6|#3987e5/);
  });

  test("the storefront block defaults to the brand teal in both the stylesheet and the editor setting", () => {
    expect(readFileSync("extensions/bundler-storefront/assets/bundle.css", "utf8")).toContain(`--mobi-accent: ${BRAND.deepTeal};`);
    expect(readFileSync("extensions/bundler-storefront/blocks/bundle.liquid", "utf8")).toMatch(new RegExp(`"id": "accent",[\\s\\S]*?"default": "${BRAND.deepTeal}"`));
  });

  test("the app shell loads the brand styles once, unescaped", () => {
    const shell = readFileSync("app/routes/app.jsx", "utf8");
    expect(shell).toContain("BRAND_CSS");
    expect(shell).toContain("dangerouslySetInnerHTML");
    expect(BRAND_CSS).toContain('[data-theme="dark"]');
  });

  test("the logo ships at the path the header uses, and the 1200px icon is kept for the Dev Dashboard upload", () => {
    const dim = (f: string) => {
      const b = readFileSync(f);
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    expect(LOGO_SRC).toBe("/mobibundler-logo.png");
    expect(dim("public/mobibundler-logo.png")).toEqual([256, 256]);
    expect(dim("docs/brand/app-icon-1200.png")).toEqual([1200, 1200]);
  });
});

describe("tiles and header", () => {
  test("KPI tiles show label, value and an optional hint", () => {
    const h = renderToStaticMarkup(<KpiGrid items={[{ label: "Net revenue", value: "$1,597.46", hint: "after refunds" }, { label: "Orders", value: "1" }]} />);
    expect(h).toContain('class="mb-kpis"');
    expect((h.match(/class="mb-kpi"/g) ?? []).length).toBe(2);
    expect(h).toContain("Net revenue");
    expect(h).toContain("$1,597.46");
    expect(h).toContain("after refunds");
  });

  test("the brand header shows the logo with alt text, the name, the tagline and status chips", () => {
    const h = renderToStaticMarkup(<BrandHeader tagline="Bundle products, lift order value" chips={["1 active bundle", "2 total"]} />);
    expect(h).toContain('src="/mobibundler-logo.png"');
    expect(h).toContain('alt="MobiBundler logo"');
    expect(h).toContain("MobiBundler");
    expect(h).toContain("1 active bundle");
    expect(renderToStaticMarkup(<BrandHeader tagline="x" />)).not.toContain("mb-brand__chips");
  });

  test("the dashboard revenue figures are drawn as tiles", () => {
    const { total } = summarizeRevenue([{ orderId: "o", bundleId: "b", source: "live", cancelled: false, reconciled: true, unitsSold: 2, unitsRefunded: 0, soldGrossMinor: 177495, soldDiscountMinor: 17749, netMinor: 159746 }]);
    const h = renderToStaticMarkup(
      <RevenueSection days={30} currency="USD" revenue={total} byBundle={[]} unmapped={{ minor: 0, orders: 0 }} otherCurrencyOrders={0}
        sync={{ lastSyncedAt: "2026-10-25T10:00:00Z", error: null, errorCode: null }} onPeriodChange={() => {}} syncControl={null} />,
    );
    expect(h).toContain('class="mb-kpi"');
    expect(h).toContain("Net bundle revenue");
    expect(h).toContain("$1,597.46");
  });
});
