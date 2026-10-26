// Brand colors sampled from the MobiBundler logo (public/mobibundler-app-icon-1200.png), plus the shared styles for the
// app's own components. Polaris components keep Shopify's look; the brand is applied only to what this app draws.
export const BRAND = {
  /** Box front and the plus badge: buttons, accents and text on light surfaces. White text on it is 5.7:1. */
  deepTeal: "#02736a",
  /** Shirt and shoe: the chart bar on light surfaces (3.5:1 on #fcfcfb; passes the chart validator). */
  teal: "#029886",
  /** Chart bar on dark surfaces (6.1:1 on #1a1a19; passes the chart validator). */
  brightTeal: "#03ad90",
  /** Box flaps: accents on dark surfaces (9.7:1 on the logo's charcoal). */
  mint: "#75eac7",
  mintLight: "#a1f8d3",
  charcoal: "#252c2c",
  paper: "#f6f8f8",
} as const;

export const LOGO_SRC = "/mobibundler-logo.png";

const DARK = `--mb-accent:${BRAND.mint};--mb-card:#1f2726;--mb-ink:#f0efec;--mb-ink2:#c3c2b7;--mb-edge:rgba(117,234,199,.22);--mb-soft:rgba(117,234,199,.12)`;
const SCOPE = [".mb-kpi", ".mb-pick", ".mb-sel", ".mb-phone", ".mb-step", ".mb-toggle", ".mb-pv__btn", ".mb-save", ".mb-brand", ".mb-card", ".mb-welcome", ".mb-stat"];
const on = (prefix: string) => SCOPE.map((c) => `${prefix}${c}`).join(",");

export const BRAND_CSS = `
.mb-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
${SCOPE.join(",")}{--mb-accent:${BRAND.deepTeal};--mb-card:#fff;--mb-ink:#0b0b0b;--mb-ink2:#52514e;--mb-edge:rgba(2,115,106,.14);--mb-soft:#e3f6f0}
@media (prefers-color-scheme:dark){${on(':root:where(:not([data-theme="light"])) ')}{${DARK}}}
${on(':root[data-theme="dark"] ')}{${DARK}}
.mb-kpi{display:flex;align-items:center;gap:12px;border:1px solid var(--mb-edge);background:var(--mb-card);border-radius:14px;padding:14px;min-width:0;position:relative;overflow:hidden}
.mb-kpi__body{min-width:0;flex:1}
.mb-kpi__label{color:var(--mb-ink2);font-size:13px;line-height:1.3}
.mb-kpi__value{color:var(--mb-ink);font-size:24px;font-weight:700;line-height:1.25;margin-top:2px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.mb-kpi__hint{color:var(--mb-ink2);font-size:12px;margin-top:2px}
.mb-spark{position:absolute;right:10px;bottom:8px;width:84px;height:34px;opacity:.95}
.mb-ico{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;flex:none;background:var(--mb-soft);color:var(--mb-accent)}
.mb-ico svg{width:20px;height:20px}
.mb-ico--blue{background:#e2f0fd;color:#1f6fc6}.mb-ico--violet{background:#ece8fb;color:#5b3fc4}.mb-ico--amber{background:#fdf1d9;color:#a8650a}.mb-ico--grey{background:#eef0f0;color:#52514e}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .mb-ico--blue{background:#173250;color:#8cc3fa}:root:where(:not([data-theme="light"])) .mb-ico--violet{background:#2a2250;color:#b6a6f5}:root:where(:not([data-theme="light"])) .mb-ico--amber{background:#43300f;color:#f3c775}:root:where(:not([data-theme="light"])) .mb-ico--grey{background:#2b3333;color:#c3c2b7}}
:root[data-theme="dark"] .mb-ico--blue{background:#173250;color:#8cc3fa}:root[data-theme="dark"] .mb-ico--violet{background:#2a2250;color:#b6a6f5}:root[data-theme="dark"] .mb-ico--amber{background:#43300f;color:#f3c775}:root[data-theme="dark"] .mb-ico--grey{background:#2b3333;color:#c3c2b7}
.mb-brand{display:flex;align-items:center;gap:14px}
.mb-brand img{width:52px;height:52px;border-radius:13px;flex:none}
.mb-brand__name{color:var(--mb-ink);font-size:18px;font-weight:650;line-height:1.2}
.mb-brand__tag{color:var(--mb-ink2);font-size:13px;margin-top:2px}
.mb-brand__chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.mb-brand__chip{border:1px solid var(--mb-edge);border-radius:999px;padding:2px 10px;font-size:12px;color:var(--mb-accent);font-weight:600}
.mb-welcome{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.mb-welcome__title{color:var(--mb-ink);font-size:26px;font-weight:750;line-height:1.2;margin:0}
.mb-welcome__sub{color:var(--mb-ink2);font-size:14px;margin:4px 0 0}
.mb-card{border:1px solid var(--mb-edge);background:var(--mb-card);border-radius:16px;padding:16px;min-width:0}
.mb-card__head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.mb-card__head .mb-ico{width:32px;height:32px;border-radius:9px}.mb-card__head .mb-ico svg{width:17px;height:17px}
.mb-card__title{color:var(--mb-ink);font-size:16px;font-weight:700;margin:0;flex:1}
.mb-card__action{color:var(--mb-accent);font-size:13px;font-weight:600;text-decoration:none}
.mb-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;align-items:start}
.mb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.mb-stat{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--mb-edge);border-radius:12px;padding:12px 14px;background:var(--mb-card)}
.mb-stat__value{color:var(--mb-ink);font-size:24px;font-weight:700;line-height:1.2}
.mb-stat__label{color:var(--mb-ink2);font-size:13px;display:flex;align-items:center;gap:6px;margin-top:2px}
.mb-dot{width:8px;height:8px;border-radius:50%;background:var(--mb-dot,#9a9a94);display:inline-block}
.mb-list{list-style:none;margin:0;padding:0}
.mb-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--mb-edge)}
.mb-row:first-child{border-top:0}
.mb-row__main{flex:1;min-width:0}
.mb-row__name{color:var(--mb-ink);font-weight:600;font-size:14px;text-decoration:none;overflow-wrap:anywhere}
.mb-row__sub{color:var(--mb-ink2);font-size:12px}
.mb-pill{border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;background:var(--mb-soft);color:var(--mb-accent);white-space:nowrap}
.mb-pill--grey{background:#eef0f0;color:#52514e}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .mb-pill--grey{background:#2b3333;color:#c3c2b7}}
:root[data-theme="dark"] .mb-pill--grey{background:#2b3333;color:#c3c2b7}
.mb-tablecard{padding:0 0 12px;overflow-x:auto}.mb-tablecard .mb-row__sub{padding:12px 16px 0}
.mb-table{width:100%;border-collapse:collapse;font-size:13px;color:var(--mb-ink)}
.mb-table th{text-align:left;font-weight:600;color:var(--mb-ink2);padding:10px 16px;background:var(--mb-soft);white-space:nowrap}
.mb-table td{padding:12px 16px;border-top:1px solid var(--mb-edge);vertical-align:middle}
.mb-namecell{display:inline-flex;align-items:center;gap:10px}
.mb-three{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;align-items:start}
.mb-kv--total{border-top:2px solid var(--mb-edge);font-weight:700}.mb-kv--total span{color:var(--mb-ink)}
.mb-neg{color:#c0312b!important}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .mb-neg{color:#ff9a93!important}}
:root[data-theme="dark"] .mb-neg{color:#ff9a93!important}
.mb-top{display:grid;gap:4px;min-width:110px;text-align:right}
.mb-edithead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.mb-edit{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:12px;align-items:start}
@media (max-width:900px){.mb-edit{grid-template-columns:minmax(0,1fr)}}
.mb-main,.mb-side{display:grid;gap:12px;min-width:0}
.mb-side{position:sticky;top:12px}
@media (max-width:900px){.mb-side{position:static}}
.mb-step{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--mb-accent);color:#fff;font-size:12px;font-weight:700}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .mb-step{color:#0b0b0b}}
:root[data-theme="dark"] .mb-step{color:#0b0b0b}
.mb-toggle{display:inline-flex;border:1px solid var(--mb-edge);border-radius:8px;overflow:hidden}
.mb-toggle button{border:0;background:transparent;color:var(--mb-ink);padding:4px 10px;font-size:12px;cursor:pointer}
.mb-toggle button[aria-pressed="true"]{background:var(--mb-accent);color:#fff}
.mb-phone{border:2px solid var(--mb-ink);border-radius:22px;padding:14px;margin:0 auto 8px;display:grid;gap:10px;background:var(--mb-card)}
.mb-phone--mobile{max-width:300px}.mb-phone--desktop{max-width:100%;border-radius:12px}
.mb-phone__bar{text-align:center;font-weight:700;font-size:13px;color:var(--mb-ink);border-bottom:1px solid var(--mb-edge);padding-bottom:8px}
.mb-pv__items{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.mb-pv__group{display:inline-flex;align-items:center;gap:6px}
.mb-pv__item{display:grid;border:1px solid var(--mb-edge);border-radius:10px;padding:8px 10px;background:var(--mb-soft);max-width:130px}
.mb-pv__name{font-size:12px;font-weight:600;color:var(--mb-ink);overflow-wrap:anywhere}
.mb-pv__plus{width:22px;height:22px;border-radius:50%;background:var(--mb-accent);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700}
.mb-pv__title{font-size:18px;font-weight:750;color:var(--mb-ink)}
.mb-pv__prices{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--mb-ink)}
.mb-pv__prices s{color:var(--mb-ink2)}.mb-pv__prices b{font-size:18px}
.mb-pv__btn{background:var(--mb-accent);color:#fff;text-align:center;border-radius:8px;padding:10px;font-weight:650}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .mb-pv__btn,:root:where(:not([data-theme="light"])) .mb-toggle button[aria-pressed="true"],:root:where(:not([data-theme="light"])) .mb-pv__plus{color:#0b0b0b}}
:root[data-theme="dark"] .mb-pv__btn,:root[data-theme="dark"] .mb-toggle button[aria-pressed="true"],:root[data-theme="dark"] .mb-pv__plus{color:#0b0b0b}
.mb-save{margin-top:10px;border-radius:10px;background:var(--mb-soft);color:var(--mb-accent);padding:10px 12px;font-weight:650;font-size:13px}
.mb-thumb{width:48px;height:48px;border-radius:10px;border:1px solid var(--mb-edge);background:var(--mb-soft);flex:none;overflow:hidden;display:inline-flex;align-items:center;justify-content:center}
.mb-thumb img{width:100%;height:100%;object-fit:cover}
.mb-sel{display:flex;align-items:center;gap:12px;border:1px solid var(--mb-edge);border-radius:12px;padding:10px 12px;background:var(--mb-card);flex-wrap:wrap}
.mb-pick{display:grid;gap:12px}
.mb-pick__product{border:1px solid var(--mb-edge);border-radius:14px;padding:12px;background:var(--mb-card);display:grid;gap:4px}
.mb-pick__head{display:flex;align-items:center;gap:12px;padding-bottom:8px}
.mb-pick__variant{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:10px;background:var(--mb-soft)}
.mb-pick__vname{font-size:13px;font-weight:600;color:var(--mb-ink)}
.mb-pill--amber{background:#fdf1d9;color:#8a5206}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .mb-pill--amber{background:#43300f;color:#f3c775}}
:root[data-theme="dark"] .mb-pill--amber{background:#43300f;color:#f3c775}
.mb-pv__img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;margin-bottom:6px}
.mb-funnel{display:grid;gap:12px}
.mb-funnel__row{display:grid;grid-template-columns:minmax(90px,1fr) 2.2fr auto;gap:10px;align-items:center;font-size:13px;color:var(--mb-ink)}
.mb-funnel__track{height:10px;border-radius:999px;background:var(--mb-soft);overflow:hidden}
.mb-funnel__fill{height:100%;border-radius:999px;background:var(--mb-accent)}
.mb-funnel__pct{color:var(--mb-ink2);min-width:44px;text-align:right}
.mb-kv{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--mb-edge);font-size:13px;color:var(--mb-ink2)}
.mb-kv:first-child{border-top:0}.mb-kv b{color:var(--mb-ink);font-variant-numeric:tabular-nums}
`;
