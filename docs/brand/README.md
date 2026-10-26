# MobiBundler brand

Colours sampled from the logo (`app-icon-1200.png`, the original 1200×1200 artwork). The same values live in
`app/bundles/brand.ts`; `tests/brand.test.tsx` checks their contrast.

| Token | Hex | Used for |
|-------|-----|----------|
| Deep teal | `#02736a` | Storefront block accent (button, savings, plus badge), KPI tile edge and brand text on light surfaces |
| Teal | `#029886` | Revenue chart bars on light surfaces |
| Bright teal | `#03ad90` | Revenue chart bars on dark surfaces |
| Mint | `#75eac7` | Accents on dark surfaces |
| Charcoal | `#252c2c` | The logo's tile background |
| Paper | `#f6f8f8` | KPI tile background (light) |

## What is branded, and what is not
Shopify's own components (buttons, badges, tables, banners) keep Shopify's look on purpose: the embedded admin uses Polaris,
and App Store review expects it. The brand is applied to what this app draws itself: the dashboard header, KPI tiles, the
Analytics chart, and the storefront bundle block.

## App icon (a manual step)
Upload `docs/brand/app-icon-1200.png` (1200×1200) as the app icon in the Dev Dashboard (app settings). It cannot be set from code.

## Existing storefront blocks
New blocks default to deep teal. A block that is already in a theme keeps the accent it was saved with (`#111111` for the
first one); change it in the theme editor (Bundle block, Accent colour) to `#02736a`.
