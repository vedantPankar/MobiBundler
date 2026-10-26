import { useState } from "react";
import { niceMax, percent, type AnalyticsResult, type DailyPoint } from "./analytics";
import { BRAND } from "./brand";
import { formatMinor } from "./format";
import { Card, KpiGrid, type Kpi } from "./KpiTile";
import type { RevenueViewState } from "./revenueSummary";

const W = 720;
const H = 240;
const M = { l: 84, r: 12, t: 16, b: 28 };

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

// One series, one hue: the logo's teal, with separate light and dark selections that pass the chart validator.
const STYLE = `
.mb-chart{--bar:${BRAND.teal};--grid:rgba(0,0,0,.09);--axis:rgba(0,0,0,.35);--ink:#0b0b0b;--ink2:#52514e;--surface:#fcfcfb}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .mb-chart{--bar:${BRAND.brightTeal};--grid:rgba(255,255,255,.12);--axis:rgba(255,255,255,.4);--ink:#f0efec;--ink2:#c3c2b7;--surface:#1a1a19}}
:root[data-theme="dark"] .mb-chart{--bar:${BRAND.brightTeal};--grid:rgba(255,255,255,.12);--axis:rgba(255,255,255,.4);--ink:#f0efec;--ink2:#c3c2b7;--surface:#1a1a19}
.mb-chart svg{width:100%;height:auto;display:block}
.mb-chart text{fill:var(--ink2);font-size:11px}
.mb-chart .mb-peak{fill:var(--ink);font-weight:600}
.mb-chart .mb-bar{fill:var(--bar)}
.mb-chart .mb-hit:hover .mb-bar,.mb-chart .mb-hit:focus .mb-bar{fill:var(--bar);stroke:var(--surface);stroke-width:2;paint-order:stroke}
.mb-chart .mb-hit:hover .mb-col,.mb-chart .mb-hit:focus .mb-col{fill:var(--grid)}
.mb-chart .mb-hit{outline:none}
.mb-chart .mb-col{fill:transparent}
.mb-chart .mb-line{fill:none;stroke:var(--bar);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.mb-chart .mb-area{fill:var(--bar);fill-opacity:.14}
.mb-chart .mb-dot{fill:var(--bar);stroke:var(--surface);stroke-width:2}
.mb-chart .mb-cross{stroke:var(--axis);stroke-dasharray:3 3}
.mb-chart .mb-tip rect{fill:var(--surface);stroke:var(--grid)}
.mb-chart .mb-tip text{fill:var(--ink)}
.mb-chart table{border-collapse:collapse;width:100%;margin-top:8px}
.mb-chart th,.mb-chart td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--grid);font-size:13px}
`;

/** A column for every day. Presentation only; the figures come from buildAnalytics. */
export function RevenueBars({ daily, currency }: { daily: DailyPoint[]; currency: string }) {
  const [active, setActive] = useState<number | null>(null);
  const money = (m: number) => formatMinor(m, currency);
  const max = Math.max(...daily.map((d) => d.netMinor), 0);
  const yMax = niceMax(max);
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;
  const slot = plotW / daily.length;
  const barW = Math.max(2, Math.min(28, slot * 0.6));
  const y = (v: number) => M.t + plotH - (v / yMax) * plotH;
  const peak = daily.reduce((best, d, i) => (d.netMinor > daily[best].netMinor ? i : best), 0);
  const every = Math.ceil(daily.length / 8);
  const shown = active ?? null;
  const readout =
    shown !== null
      ? `${dayLabel(daily[shown].date)} · ${money(daily[shown].netMinor)} · ${daily[shown].orders} order(s)`
      : `Best day: ${dayLabel(daily[peak].date)} · ${money(daily[peak].netMinor)}`;

  return (
    <div className="mb-chart">
      {/* STYLE is a static constant. A <style> block is raw text, so it must not go through React's text escaping (it would turn the quotes in selectors into entities and break dark mode). */}
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <s-text>{readout}</s-text>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Net bundle revenue per day">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={M.l} x2={W - M.r} y1={y(yMax * f)} y2={y(yMax * f)} stroke={f === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={M.l - 8} y={y(yMax * f) + 4} textAnchor="end">
              {money(Math.round(yMax * f))}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = M.l + slot * i;
          const bx = x + (slot - barW) / 2;
          const h = (d.netMinor / yMax) * plotH;
          const r = Math.min(4, barW / 2, h);
          const top = y(d.netMinor);
          return (
            <g
              key={d.date}
              className="mb-hit"
              tabIndex={0}
              role="img"
              aria-label={`${dayLabel(d.date)}: ${money(d.netMinor)}, ${d.orders} order(s)`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <rect className="mb-col" x={x} y={M.t} width={slot} height={plotH} />
              {h > 0 && (
                // square at the baseline, 4px-rounded at the data end
                <path
                  className="mb-bar"
                  d={`M${bx},${M.t + plotH} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${M.t + plotH} Z`}
                />
              )}
              {i % every === 0 && (
                <text x={x + slot / 2} y={H - 8} textAnchor="middle">
                  {dayLabel(d.date)}
                </text>
              )}
            </g>
          );
        })}
        {max > 0 && (
          <text className="mb-peak" x={M.l + slot * peak + slot / 2} y={y(max) - 6} textAnchor="middle">
            {money(max)}
          </text>
        )}
      </svg>
      <details>
        <summary>View as table</summary>
        <table>
          <thead>
            <tr>
              <th>Day (UTC)</th>
              <th>Orders</th>
              <th>Net revenue</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{d.orders}</td>
                <td>{money(d.netMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** The same data as RevenueBars as a line with a soft area, for the dashboard. Hover or focus a day to read it. */
export function RevenueLine({ daily, currency }: { daily: DailyPoint[]; currency: string }) {
  const [active, setActive] = useState<number | null>(null);
  const money = (m: number) => formatMinor(m, currency);
  const yMax = niceMax(Math.max(...daily.map((d) => d.netMinor), 0));
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;
  const x = (i: number) => M.l + (daily.length === 1 ? plotW / 2 : (i / (daily.length - 1)) * plotW);
  const y = (v: number) => M.t + plotH - (v / yMax) * plotH;
  const pts = daily.map((d, i) => `${x(i).toFixed(1)},${y(d.netMinor).toFixed(1)}`);
  const every = Math.ceil(daily.length / 8);
  const base = M.t + plotH;
  const a = active;
  return (
    <div className="mb-chart">
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Net bundle revenue per day">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={M.l} x2={W - M.r} y1={y(yMax * f)} y2={y(yMax * f)} stroke={f === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={M.l - 8} y={y(yMax * f) + 4} textAnchor="end">{money(Math.round(yMax * f))}</text>
          </g>
        ))}
        <polygon className="mb-area" points={`${x(0)},${base} ${pts.join(" ")} ${x(daily.length - 1)},${base}`} />
        <polyline className="mb-line" points={pts.join(" ")} />
        {a !== null && <line className="mb-cross" x1={x(a)} x2={x(a)} y1={M.t} y2={base} />}
        {daily.map((d, i) => (
          <g
            key={d.date}
            tabIndex={0}
            role="img"
            aria-label={`${dayLabel(d.date)}: ${money(d.netMinor)}, ${d.orders} order(s)`}
            style={{ outline: "none" }}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <rect x={x(i) - plotW / daily.length / 2} y={M.t} width={plotW / daily.length} height={plotH} fill="transparent" />
            <circle className="mb-dot" cx={x(i)} cy={y(d.netMinor)} r={a === i ? 6 : 4} />
            {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle">{dayLabel(d.date)}</text>}
          </g>
        ))}
        {a !== null && (
          <g className="mb-tip" transform={`translate(${Math.min(Math.max(x(a) - 55, M.l), W - M.r - 110)},${Math.max(y(daily[a].netMinor) - 50, 0)})`}>
            <rect width={110} height={40} rx={6} />
            <text x={8} y={16}>{dayLabel(daily[a].date)}</text>
            <text x={8} y={32} style={{ fontWeight: 700, fontSize: 13 }}>{money(daily[a].netMinor)}</text>
          </g>
        )}
      </svg>
      <details>
        <summary>View as table</summary>
        <table>
          <thead><tr><th>Day (UTC)</th><th>Orders</th><th>Net revenue</th></tr></thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date}><td>{d.date}</td><td>{d.orders}</td><td>{money(d.netMinor)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export interface AnalyticsSectionProps {
  days: number;
  currency: string;
  result: AnalyticsResult;
  /** What the order data allows us to claim. Storefront counts do not depend on it. */
  revenueState: RevenueViewState;
  sync: { error: string | null; errorCode: string | null };
  onPeriodChange: (days: number) => void;
}

export function AnalyticsSection({ days, currency, result, revenueState, sync, onPeriodChange }: AnalyticsSectionProps) {
  const money = (m: number) => formatMinor(m, currency);
  const hasRevenue = revenueState === "data" || revenueState === "empty";
  const rev = (v: string) => (hasRevenue ? v : "—");
  const k = result.kpis;

  const orderSeries = result.daily.map((d) => d.orders);
  const revSeries = result.daily.map((d) => d.netMinor);
  const top = result.perBundle.slice(0, 5);
  const topNet = Math.max(...top.map((b) => b.netRevenueMinor), 0);
  const tiles2: Kpi[] = [
    { label: "Bundle views", value: String(k.views), icon: "eye" },
    { label: "Add to cart", value: String(k.addToCarts), icon: "cart" },
    { label: "View to cart rate", value: percent(k.viewToCartRate), icon: "percent", tone: "violet" },
    { label: "Bundle orders", value: rev(String(k.orders)), icon: "box", tone: "blue", spark: hasRevenue ? orderSeries : undefined },
    { label: "Net revenue", value: rev(money(k.netRevenueMinor)), icon: "dollar", spark: hasRevenue ? revSeries : undefined },
  ];

  return (
    <>
      <s-section>
        <s-stack gap="base">
          <s-paragraph>Track the performance of your bundles and understand how they’re contributing to your store.</s-paragraph>
          <s-select label="Period" value={String(days)} onChange={(e: Event) => onPeriodChange(Number((e.currentTarget as HTMLSelectElement).value))}>
            {[7, 30, 60].map((d) => (
              <s-option key={d} value={String(d)}>
                Last {d} days
              </s-option>
            ))}
          </s-select>
        </s-stack>
      </s-section>

      {!hasRevenue && (
        <s-banner tone={sync.errorCode === "FAILED" ? "warning" : "critical"} heading="Revenue figures are unavailable">
          <s-paragraph>
            {sync.error ?? "Orders have not been synced yet. Open the dashboard and click “Sync orders now”."} Views and add-to-cart counts below do not
            depend on this and are still shown.
          </s-paragraph>
        </s-banner>
      )}

      <s-stack gap="base">
        <KpiGrid items={tiles2} />

        <div className="mb-two">
          <Card title="Net revenue by day" icon="chart">
            {!hasRevenue ? (
              <s-paragraph>Unavailable until order data has synced.</s-paragraph>
            ) : result.daily.every((d) => d.netMinor === 0) ? (
              <s-paragraph>No bundle revenue in the last {days} days.</s-paragraph>
            ) : (
              <RevenueLine daily={result.daily} currency={currency} />
            )}
          </Card>
          <Card title="Sales funnel" icon="funnel">
            <div className="mb-funnel">
              {[
                { label: "Bundle views", n: k.views },
                { label: "Add to cart", n: k.addToCarts },
                ...(hasRevenue ? [{ label: "Bundle orders (all sources)", n: k.orders }] : []),
              ].map((step) => {
                const pct = k.views > 0 ? Math.min(100, (step.n / k.views) * 100) : 0;
                return (
                  <div className="mb-funnel__row" key={step.label}>
                    <span>{step.label}</span>
                    <span className="mb-funnel__track">
                      <span className="mb-funnel__fill" style={{ display: "block", width: `${pct}%` }} />
                    </span>
                    <span>
                      <b>{step.n}</b> <span className="mb-funnel__pct">{k.views > 0 ? `${Math.round(pct)}%` : "—"}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mb-row__sub">Percent of bundle views. Orders include bundles bought without the block, so this is not a strict funnel.</div>
          </Card>
        </div>

        <div className="mb-three">
          <Card title="Revenue breakdown" icon="dollar">
            <div className="mb-kv"><span>Gross bundle sales (list price)</span><b>{rev(money(k.grossMinor))}</b></div>
            <div className="mb-kv"><span>Bundle discounts</span><b className="mb-neg">{rev(k.discountsMinor > 0 ? `-${money(k.discountsMinor)}` : money(0))}</b></div>
            <div className="mb-kv"><span>Refunded or cancelled</span><b>{rev(money(k.refundedMinor))}</b></div>
            <div className="mb-kv mb-kv--total"><span>Net bundle revenue</span><b>{rev(money(k.netRevenueMinor))}</b></div>
          </Card>
          <Card title="Key metrics" icon="chart">
            <div className="mb-kv"><span>Average bundle order</span><b>{rev(k.averageOrderMinor === null ? "—" : money(k.averageOrderMinor))}</b></div>
            <div className="mb-kv"><span>Discounts as % of sales</span><b>{rev(percent(k.discountRate))}</b></div>
            <div className="mb-kv"><span>Refunded or cancelled</span><b>{rev(percent(k.refundRate))}</b></div>
            <div className="mb-kv"><span>Bundle orders</span><b>{rev(String(k.orders))}</b></div>
          </Card>
          <Card title="Top performing bundles" icon="trophy">
            {top.length === 0 ? (
              <s-paragraph>No bundle activity in this period yet.</s-paragraph>
            ) : (
              <ul className="mb-list">
                {top.map((b) => (
                  <li className="mb-row" key={b.bundleId}>
                    <div className="mb-row__main">
                      <div className="mb-row__name">{b.name}</div>
                      <div className="mb-row__sub">{rev(`${b.orders} order${b.orders === 1 ? "" : "s"}`)}</div>
                    </div>
                    <div className="mb-top">
                      <b>{rev(money(b.netRevenueMinor))}</b>
                      <span className="mb-funnel__track">
                        <span className="mb-funnel__fill" style={{ display: "block", width: `${hasRevenue && topNet > 0 ? (b.netRevenueMinor / topNet) * 100 : 0}%` }} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Performance by bundle" icon="list">
          {result.perBundle.length === 0 ? (
            <s-paragraph>No bundle activity in this period yet.</s-paragraph>
          ) : (
            <div className="mb-tablecard" style={{ padding: 0 }}>
              <table className="mb-table">
                <thead>
                  <tr>
                    <th>Bundle</th>
                    <th>Views</th>
                    <th>Add to cart</th>
                    <th>Cart rate</th>
                    <th>Orders</th>
                    <th>Net revenue</th>
                    <th>Discount rate</th>
                    <th>Refund rate</th>
                  </tr>
                </thead>
                <tbody>
                  {result.perBundle.map((b) => (
                    <tr key={b.bundleId}>
                      <td>{b.name}</td>
                      <td>{b.views}</td>
                      <td>{b.addToCarts}</td>
                      <td>{percent(b.addRate)}</td>
                      <td>{rev(String(b.orders))}</td>
                      <td>{rev(money(b.netRevenueMinor))}</td>
                      <td>{rev(percent(b.discountRate))}</td>
                      <td>{rev(percent(b.refundRate))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </s-stack>

      <s-section>
        <s-stack gap="small">
          <s-text>
            View to cart rate = add-to-cart events / views, counted by the bundle block. Orders include bundles bought without the block (items added one
            by one), so orders per add-to-cart is not shown as a conversion rate{k.ordersPerCart === null ? "" : ` (currently ${percent(k.ordersPerCart, 0)} orders per add-to-cart)`}.
          </s-text>
          <s-text>
            Discount rate = discounts / gross bundle sales. Refund rate = value of refunded units and cancelled orders / net sold. Days are UTC. Views are
            deduplicated per browser session per hour. Rates show “—” when there is nothing to divide by.
          </s-text>
        </s-stack>
      </s-section>
    </>
  );
}
