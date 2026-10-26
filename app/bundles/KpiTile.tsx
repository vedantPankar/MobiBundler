import type { ReactNode } from "react";
import { LOGO_SRC } from "./brand";

export type IconName = "dollar" | "box" | "bag" | "tag" | "eye" | "cart" | "percent" | "funnel" | "clock" | "chart" | "list" | "play" | "pause" | "doc" | "trophy";
export type IconTone = "teal" | "blue" | "violet" | "amber" | "grey";

// 24px stroke icons, drawn here so the app needs no icon dependency.
const PATHS: Record<IconName, ReactNode> = {
  dollar: <path d="M12 3v18M16.5 7.5C15.5 6.4 13.9 6 12 6c-2.5 0-4 1.1-4 2.8 0 4 8 1.8 8 6 0 1.8-1.7 3.2-4 3.2-2 0-3.700-.6-4.700-1.800" />,
  box: <path d="M12 2.800l8 4.200v10l-8 4.200-8-4.200V7zM4 7l8 4.200L20 7M12 11.200v10" />,
  bag: <path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" />,
  tag: <path d="M3 12V4h8l10 10-8 8zM7.500 8.500h.01" />,
  eye: <path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  cart: <path d="M3 4h2l2.500 11h10L20 7H6M9 20h.01M17 20h.01" />,
  percent: <path d="M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
  funnel: <path d="M3 4h18l-7 8v7l-4 2v-9z" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  play: <path d="M7 4l13 8-13 8z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  doc: <path d="M6 3h8l4 4v14H6zM14 3v4h4" />,
  trophy: <path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H4v2a3 3 0 0 0 4 2.800M16 6h4v2a3 3 0 0 1-4 2.800M12 14v4M8 21h8" />,
};

export function Icon({ name, tone = "teal" }: { name: IconName; tone?: IconTone }) {
  return (
    <span className={tone === "teal" ? "mb-ico" : `mb-ico mb-ico--${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {PATHS[name]}
      </svg>
    </span>
  );
}

/** A tiny trend line from real daily values. Drawn only when there is something to show (two or more points, not all zero). */
export function Spark({ values, tone = "teal" }: { values: number[]; tone?: IconTone }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const w = 84;
  const h = 34;
  const max = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - (v / max) * (h - 8)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const color = { teal: "#029886", blue: "#2a78d6", violet: "#6b4fd8", amber: "#c98a1a", grey: "#8a8a84" }[tone];
  return (
    <svg className="mb-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={color} fillOpacity={0.14} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface Kpi {
  label: string;
  value: string;
  hint?: string;
  icon?: IconName;
  tone?: IconTone;
  /** Real per-day values for the trend line; omit when there is no daily series for this figure. */
  spark?: number[];
}

/** A row of figures drawn as brand cards. Styles come from BRAND_CSS, loaded once for the whole app. */
export function KpiGrid({ items }: { items: Kpi[] }) {
  return (
    <div className="mb-kpis">
      {items.map((k) => (
        <div className="mb-kpi" key={k.label}>
          {k.icon && <Icon name={k.icon} tone={k.tone} />}
          <div className="mb-kpi__body">
            <div className="mb-kpi__label">{k.label}</div>
            <div className="mb-kpi__value">{k.value}</div>
            {k.hint && <div className="mb-kpi__hint">{k.hint}</div>}
          </div>
          {k.spark && <Spark values={k.spark} tone={k.tone} />}
        </div>
      ))}
    </div>
  );
}

/** Greeting row: title and subtitle on the left, controls (period picker) on the right. */
export function Welcome({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="mb-welcome">
      <div>
        <h2 className="mb-welcome__title">{title}</h2>
        <p className="mb-welcome__sub">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function Card({ title, icon, tone, action, children }: { title: string; icon?: IconName; tone?: IconTone; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-card">
      <div className="mb-card__head">
        {icon && <Icon name={icon} tone={tone} />}
        <h3 className="mb-card__title">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface Stat {
  label: string;
  value: number;
  dot: string;
  icon: IconName;
  tone?: IconTone;
}

export function StatTiles({ items }: { items: Stat[] }) {
  return (
    <div className="mb-stats">
      {items.map((s) => (
        <div className="mb-stat" key={s.label}>
          <div>
            <div className="mb-stat__value">{s.value}</div>
            <div className="mb-stat__label">
              <span className="mb-dot" style={{ ["--mb-dot" as string]: s.dot }} />
              {s.label}
            </div>
          </div>
          <Icon name={s.icon} tone={s.tone} />
        </div>
      ))}
    </div>
  );
}

/** Logo, name and a one-line status. */
export function BrandHeader({ tagline, chips }: { tagline: string; chips?: string[] }) {
  return (
    <div className="mb-brand">
      <img src={LOGO_SRC} alt="MobiBundler logo" width={52} height={52} />
      <div>
        <div className="mb-brand__name">MobiBundler</div>
        <div className="mb-brand__tag">{tagline}</div>
        {chips && chips.length > 0 && (
          <div className="mb-brand__chips">
            {chips.map((c) => (
              <span className="mb-brand__chip" key={c}>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
