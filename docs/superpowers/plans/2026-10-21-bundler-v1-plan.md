# MobiBundler v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fixed-product bundles (percentage or fixed-amount-off) created in the embedded admin, rendered by the `bundler-storefront` theme extension, added to cart, and discounted by one shared Discount Function per shop.

**Architecture:** One shared automatic app discount per shop carries all active bundles in a single `$app` metafield (1 of Shopify's 25 per-store function-discount slots). A pure allocation engine (`extensions/bundle-discount/src/engine.ts`) is the only pricing implementation; the Function and the admin preview both use it. Strategy interface + `pricing.kind` dispatch keep fixed-price bundles additive later. Prisma stays portable (SQLite dev, generated PostgreSQL schema for prod).

**Tech Stack:** React Router 7, `@shopify/shopify-app-react-router`, Polaris web components, Prisma 6, Zod, Vitest, Shopify Function (TypeScript, API 2026-07), Theme App Extension.

**Spec:** `docs/superpowers/specs/2026-10-21-bundler-v1-design.md`

## Global Constraints
- New code is TypeScript. Do not rewrite `app/shopify.server.js`, `app/db.server.js`, or any generated template file except where a task names it.
- Preserve the `Session` model and `prisma/dev.sqlite` data. Never run `prisma migrate reset`, `db push --force-reset`, or delete `dev.sqlite`.
- API version `2026-07` everywhere (app, codegen, webhooks, Function). Not `2027-01` (release candidate).
- Scopes v1: `read_products,write_discounts` (+ `write_app_proxy` only if Task 0 proves it is needed). No `read_orders`. No purchase/revenue/conversion metrics anywhere.
- Config constants: `CONFIG_NAMESPACE = "$app"`, `CONFIG_KEY = "function-configuration"`, config `v = 1`, budget 64 KB serialized, ≤ 10 components per bundle, ≥ 2 distinct variants, `combinesWith = {productDiscounts:false, orderDiscounts:false, shippingDiscounts:true}`.
- Money: integers only. Percentage = basis points (1..10000), fixed amount = minor units of shop currency.
- Every DB query includes `shop`. `prisma.bundle*` is touched only in `app/bundles/repo.server.ts`.
- Do **not** run `shopify app deploy`, publish, release, or touch production resources. `shopify app dev` / `shopify store execute` only against a development store the owner names. Public distribution is the production target; custom distribution does not run Functions on non-Plus stores.
- Validate every Admin GraphQL string with the Shopify skill validator (`--api admin --version 2026-07`), Polaris markup with `--api polaris-app-home`, Liquid with `--api liquid --context app`. Fix what it reports.
- Commits: the repo has **zero commits**. Make the first commit the untouched template baseline (Task 1, Step 1), and only commit when the owner has OK'd committing. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

## Execution Summary

**Mode:** subagent-driven; one fresh subagent per task; the controller reviews each task's diff and test output before dispatching the next. No task deploys, publishes, installs into a store, or modifies production resources. Any live-store action is listed below and needs the owner's explicit yes first.

**Decisions on record (owner, 2026-10-21):** public App Store distribution is the production target; dev store is owner-controlled (`mobibundler.myshopify.com`, from `.shopify/project.json`); Task 0 runs first; architecture-dependent work stays blocked until spike findings are reviewed.

### Dependencies and gates

| Task | Depends on | Blocked by spike? | Gate to start |
|---|---|---|---|
| 0 Live spikes | none | n/a | **Owner approves each live action (Task 0 "Live actions")** |
| 1 Test infra + schema | none | No | Owner OK for DB migration on local `dev.sqlite` (backup first) |
| 2 Engine | none | No | none |
| 3 Function adapter | 2 | **Yes** (input query + `$app` read, `presentmentCurrencyRate` location, S2) | Task 0 reviewed |
| 4 Validation/repo | 1, 2 | Only `CONFIG_NAMESPACE` value (default `$app`, edit later) | none |
| 5 Sync + gateway | 3, 4 | **Yes** (S1 shared-discount viability, S2 write path, update mutation shape) | Task 0 reviewed |
| 6 Admin list/dashboard | 5 | Via 5 | after 5 |
| 7 Wizard | 5, 6 | Via 5 | after 6 |
| 8 Webhooks/compliance | 4, 5 | Via 5 | after 5 |
| 9 Proxy + theme block | 4, 7 | Proxy scope (`write_app_proxy`) from Task 0 | after 7 |
| 10 Diagnostics + docs | 5, 8, 9 | Via 5 | after 9 |
| 11 Final verification | all | n/a | after 10 |

**Allowed before the spike review:** Tasks 1, 2, 4 (independent of unverified results). **Blocked until findings are reviewed:** 3, 5, 6, 7, 8, 9, 10, 11.

### Files affected (by task)
0: `docs/superpowers/spikes/2026-10-21-results.md`, spec §3; creates `extensions/bundle-discount/` scaffold (needed to run S2). 1: `package.json`, `prisma/schema.prisma`, new migration, `vitest.config.ts`, `tests/*`, `scripts/gen-postgres-schema.mjs`, `prisma/postgres/schema.prisma`, `.gitignore`. 2: `extensions/bundle-discount/src/engine*.ts`. 3: `extensions/bundle-discount/src/{config,cart_lines_discounts_generate_run}.ts`+tests+graphql. 4: `app/bundles/{types,validation,config,repo.server}.ts`, `strategies/*`, tests. 5: `app/bundles/{sync,shopifyDiscount}.server.ts`, `shopify.app.toml` (scopes, API version). 6: `app/routes/app.bundles._index.tsx`, `app.jsx` (nav), `app._index.jsx`, `actions.server.ts`, `index.server.ts`. 7: wizard routes/components, `shopifyCatalog.server.ts`, `save.server.ts`, `pricingPreview.ts`. 8: webhook routes, `webhookHandlers.server.ts`, `webhooks.app.uninstalled.jsx` (additive), toml. 9: `app_proxy.*` routes, `bundler-storefront` block/assets/locales, toml `[app_proxy]`. 10: diagnostics route/service, dashboard card, `docs/deployment.md`. 11: `docs/manual-test-checklist.md`, spec statuses.

### Acceptance criteria (per task)
- **0:** results file records, with pasted command output, (S2) which namespace pair wrote and read non-null in the Function input and Admin API, (S1) the count and exact error at the capacity limit and that our shared discount counts as 1, (S3) totals for bundle-only / +native % / +free shipping, and whether `write_app_proxy` was required. Spec §3 statuses updated. Every spike discount deleted. Owner reviews before Tasks 3+.
- **1:** `npm test` passes incl. schema parity; migration SQL has no DROP/ALTER of `Session`; `Session` row count equals the backup's; `prisma/dev.sqlite.bak` exists.
- **2:** all engine tests pass; engine has zero imports; deterministic under shuffled input; 200-line/50-bundle case < 200 ms.
- **3:** adapter/config tests pass; `shopify app function build` succeeds; `shopify app function run` on a fixture returns the expected candidates; instruction count recorded and ≤ 50% of the limit.
- **4:** validation/config/repo/isolation tests pass; `noDirectPrisma` passes; typecheck passes.
- **5:** sync tests pass (create once, noop on same hash, update same id, deactivate/reactivate, error + retry, budget, per-shop); every Admin GraphQL string passes the skill validator at `2026-07`; scopes `read_products,write_discounts` only; toml validates.
- **6–7:** action/save/preview tests pass; markup passes the Polaris validator; cross-shop ids 404; client form data never trusted (variants re-fetched); typecheck/lint pass.
- **8:** handler tests pass; compliance route verifies HMAC (invalid → 401 via `authenticate.webhook`), handles all three topics with 200; uninstall purges bundles; toml validates (compliance topics present, as App Store review requires).
- **9:** event/public-bundle/rate-limit tests pass; Liquid passes the validator; `build` succeeds; block never sends a price; only active bundles of the verifying shop are served.
- **10:** diagnostics tests cover every code; deployment doc covers public-vs-custom, Postgres baseline/deploy, env vars, nothing-deployed note, future purchase-attribution requirements.
- **11:** full gate output pasted (test, typecheck, lint, build, function build, config validate, Session count); manual checklist written; report lists everything unverified; no deploy performed.

### Tests (summary)
Unit: engine, config, validation, rate limit. Integration (SQLite via migrations): repo isolation/concurrency, sync, actions, save, events, webhooks, diagnostics. Structural: schema parity, no direct prisma. Function: fixtures + build + instruction count. Manual (owner, dev store): `docs/manual-test-checklist.md`.

### Public-distribution requirements verified (docs, 2026-10-21)
App Store apps must subscribe to and verify the mandatory compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) even if no personal data is stored; invalid HMAC must return 401; missing/failing handlers cause rejection. Apps configured by Shopify CLI use Shopify-managed installation. Billing for any charges must use Shopify's billing (v1 is free; billing is out of scope). The `application_url` and redirect URLs must be real, working URLs at review time (currently `https://example.com`). Reviewers use the published requirements checklist; the full App Store checklist (listing, demo store, screenshots) is a launch task outside v1.

---

## Task 0: Live spikes S1–S3 (owner-assisted gate)

**Live actions (each needs the owner's explicit approval before it is run):**

| # | Action | Store/permissions | Reversible? |
|---|---|---|---|
| a | `shopify auth` / CLI login if not logged in | Partner/org account of the owner | yes |
| b | `shopify app dev` (previews against the dev store, **installs the app** if not installed, creates/updates dev preview of the extensions; no release) | `mobibundler.myshopify.com`; approves scopes `read_products,write_discounts` (after Task 5 toml edit) or current scopes | App uninstall removes it; dev preview only |
| c | `shopify store auth --scopes read_discounts,write_discounts` | same store | token revocable |
| d | Create ≥1 test automatic app discount + metafield (S2), up to 26 test discounts (S1) | same store | yes: all titled `SPIKE …`, deleted at end |
| e | Create native test discounts for S3 and a theme-independent test cart | same store | yes: deleted at end |

Nothing touches any store other than the owner-named dev store. No `shopify app deploy`.

Needs a development store and an interactive login the agent does not have. The owner runs the commands (`! <cmd>` in the session) and pastes output; the agent records results in spec section 3. Tasks 1–4 do not depend on the outcome except `CONFIG_NAMESPACE`; Tasks 5+ do.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-bundler-v1-design.md` (section 3: replace "UNVERIFIED/LIVE" with results)
- Create: `docs/superpowers/spikes/2026-10-21-results.md`

**Interfaces:**
- Produces: confirmed `CONFIG_NAMESPACE` value (default `"$app"`), confirmed need for `write_app_proxy`, confirmed behaviour of the 26th function discount.

- [ ] **Step 1: Owner confirms distribution and dev store**

Owner checks in the Dev Dashboard that app `MobiBundler` (client_id `9eecbb46290ff6e7cd0fca498ad07eb4`) uses **public** distribution. If custom or unsure: create a new public app, run `npm run config:link`, and stop until done. Owner names the dev store domain (`<dev-store>.myshopify.com`).

- [ ] **Step 2: Scaffold the Function so the spike can use it** (this is Task 3 Step 1, done early)

Run: `npm run generate -- extension --template discount --flavor typescript --name bundle-discount`
Edit `extensions/bundle-discount/shopify.extension.toml` so `api_version = "2026-07"`, keep only the `cart.lines.discounts.generate.run` target, and replace its input query with:
```graphql
query CartInput {
  cart { lines { id quantity cost { amountPerQuantity { amount currencyCode } }
    merchandise { __typename ... on ProductVariant { id } } } }
  discount { discountClasses metafield(namespace: "$app", key: "function-configuration") { jsonValue } }
}
```
Run: `cd extensions/bundle-discount && npm exec shopify app function typegen` — Expected: generated types for `CartInput`; if `$app` in the query is rejected, record the error text verbatim in the results file.

- [ ] **Step 3: Start the dev session against the dev store**

Owner runs: `! npm run dev` (choose the named dev store). Expected: Function appears in the dev store's app extensions. (This is a dev preview, not a release.) If CLI asks for `write_app_proxy` or other scopes, record it.

- [ ] **Step 4: S2: write with `$app`, read back**

Owner runs (mutation, dev store only):
```bash
shopify store auth --store <dev-store>.myshopify.com --scopes read_discounts,write_discounts
shopify store execute --store <dev-store>.myshopify.com --allow-mutations --query 'mutation { discountAutomaticAppCreate(automaticAppDiscount: { title: "SPIKE shared", functionHandle: "bundle-discount", discountClasses: [PRODUCT], combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true }, startsAt: "2026-10-21T00:00:00Z", metafields: [{ namespace: "$app", key: "function-configuration", type: "json", value: "{\"v\":1,\"bundles\":[]}" }] }) { automaticAppDiscount { discountId } userErrors { field message code } } }'
```
Then read it back (replace the id from the output):
```bash
shopify store execute --store <dev-store>.myshopify.com --query 'query { discountNode(id: "<DISCOUNT_ID>") { metafield(namespace: "$app", key: "function-configuration") { namespace key jsonValue } metafields(first: 10) { nodes { namespace key } } } }'
```
Expected: `metafield` non-null and listed namespace like `app--<id>`. Run the Function against a real cart in the dev store's storefront (add any item, view checkout) after the Task 3 logger or use `shopify app function replay`. **Record:** does the Function input contain the JSON (`jsonValue` non-null)? If `metafield` is null: retry with `namespace: "default"` write and `$app` read, then with the explicit `app--<id>` namespace, and record which pair works. Update `CONFIG_NAMESPACE` accordingly.

- [ ] **Step 5: S1: capacity**

Using the same command pattern, create function discounts titled `SPIKE n` until a `userErrors` response appears (or 26 exist). Record: the count at failure, the exact `code`/`message`, and whether the shared discount counts as one. Then delete all `SPIKE` discounts: `discountAutomaticDelete(id:)` for each. Expected per docs: failure at 26.

- [ ] **Step 6: S3: stacking (manual)**

In the dev store create a native 10% automatic product discount, a free-shipping discount, and activate the spike shared discount with a real bundle config (two variants, 20%). Check cart/checkout for: bundle only; bundle + native 10% on the same product; bundle + free shipping. Record the totals.

- [ ] **Step 7: Record, decide, commit docs**

Write results to `docs/superpowers/spikes/2026-10-21-results.md`, update spec section 3 statuses, then report to the owner. **Gate:** if S1 shows the shared approach also fails (e.g. our single discount is rejected), stop and re-plan; otherwise proceed.

---

## Task 1: Test infrastructure, schema and migration

**Files:**
- Create: `vitest.config.ts`, `tests/globalSetup.ts`, `tests/testDb.ts`, `scripts/gen-postgres-schema.mjs`, `tests/schemaParity.test.ts`
- Modify: `package.json` (scripts, deps), `prisma/schema.prisma`, `.gitignore`
- Create (generated): `prisma/migrations/<ts>_add_bundles/migration.sql`, `prisma/postgres/schema.prisma`

**Interfaces:**
- Produces: `npm test`; `createTestPrisma(): Promise<PrismaClient>` and `resetTestDb(prisma): Promise<void>` from `tests/testDb.ts`; Prisma models `Bundle`, `BundleItem`, `BundleEvent`, `ShopDiscount`.

- [ ] **Step 1: Baseline commit and DB backup**

```bash
git add -A && git commit -m "chore: import Shopify React Router template baseline"
cp prisma/dev.sqlite prisma/dev.sqlite.bak
printf '\nprisma/*.bak\nprisma/.tmp-test/\n' >> .gitignore
```
(Skip the commit if the owner has not OK'd committing; keep the backup.)

- [ ] **Step 2: Install dev tooling**

Run: `npm install zod && npm install -D vitest`
Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Write `vitest.config.ts` and test DB helper**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "extensions/**/*.test.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    pool: "forks",
  },
});
```
```ts
// tests/globalSetup.ts  (creates an isolated sqlite DB from the real migrations; never touches prisma/dev.sqlite)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

export default function setup() {
  const dir = path.resolve("prisma/.tmp-test");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const schema = readFileSync("prisma/schema.prisma", "utf8").replace(
    /url\s*=\s*"file:[^"]*"/,
    `url = "file:${path.join(dir, "test.sqlite")}"`,
  );
  writeFileSync(path.join(dir, "schema.prisma"), schema);
  cpSync("prisma/migrations", path.join(dir, "migrations"), { recursive: true });
  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", path.join(dir, "schema.prisma")], { stdio: "inherit" });
  process.env.TEST_DATABASE_URL = `file:${path.join(dir, "test.sqlite")}`;
}
```
```ts
// tests/testDb.ts
import { PrismaClient } from "@prisma/client";

export async function createTestPrisma(): Promise<PrismaClient> {
  return new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
}
export async function resetTestDb(prisma: PrismaClient): Promise<void> {
  await prisma.bundleItem.deleteMany();
  await prisma.bundleEvent.deleteMany();
  await prisma.bundle.deleteMany();
  await prisma.shopDiscount.deleteMany();
}
```

- [ ] **Step 4: Add models to `prisma/schema.prisma`** (append after `Session`; copy the four model blocks verbatim from spec section 4.3).

- [ ] **Step 5: Create the additive migration**

Run: `npx prisma migrate dev --name add_bundles --create-only`
Inspect `prisma/migrations/*_add_bundles/migration.sql`: Expected: only `CREATE TABLE`/`CREATE INDEX` for the four new tables; **no** `DROP`/`ALTER` on `Session`. Then `npx prisma migrate deploy && npx prisma generate`.

- [ ] **Step 6: Postgres schema generator + parity test (test first)**

```ts
// tests/schemaParity.test.ts
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

const models = (s: string) => s.slice(s.indexOf("model ")).trim();

test("postgres schema models equal sqlite models", () => {
  execFileSync("node", ["scripts/gen-postgres-schema.mjs"]);
  const sqlite = readFileSync("prisma/schema.prisma", "utf8");
  const pg = readFileSync("prisma/postgres/schema.prisma", "utf8");
  expect(models(pg)).toBe(models(sqlite));
  expect(pg).toContain('provider = "postgresql"');
  expect(pg).toContain('env("DATABASE_URL")');
});
```
Run: `npx vitest run tests/schemaParity.test.ts`: Expected: FAIL (script missing).
```js
// scripts/gen-postgres-schema.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("prisma/schema.prisma", "utf8");
const out = src
  .replace('provider = "sqlite"', 'provider = "postgresql"')
  .replace(/url\s*=\s*"file:[^"]*"/, 'url      = env("DATABASE_URL")');
mkdirSync("prisma/postgres", { recursive: true });
writeFileSync("prisma/postgres/schema.prisma", out);
```
Run the test again: Expected: PASS.

- [ ] **Step 7: Verify nothing was lost, commit**

Run: `sqlite3 prisma/dev.sqlite "select count(*) from Session;"` and compare with `prisma/dev.sqlite.bak`. Expected: equal. Run `npm test`: PASS.
```bash
git add -A && git commit -m "feat(db): add Bundle, BundleItem, BundleEvent, ShopDiscount + test infra"
```

---

## Task 2: Pure allocation engine (TDD)

**Files:**
- Create: `extensions/bundle-discount/src/engine.ts`, `extensions/bundle-discount/src/engine.test.ts`
(Task 0 Step 2 already created the extension directory; if skipped, create the directory only.)

**Interfaces:**
- Produces (exact):
```ts
export type PricingModel =
  | { kind: "percentage"; basisPoints: number }
  | { kind: "fixed_amount_off"; amountMinor: number };
export interface BundleEntry { id: string; pricing: { kind: string } & Record<string, unknown>; items: { variantId: string; quantity: number }[] }
export interface CartLineInput { id: string; variantId: string; quantity: number; unitPriceMinor: number }
export interface Allocation { bundleId: string; lineId: string; quantity: number; discountMinor: number }
export function allocate(bundles: BundleEntry[], lines: CartLineInput[]): Allocation[];
export function distribute(total: number, weights: number[]): number[];
export function toMinor(amount: string, exp: number): number;
export function fromMinor(minor: number, exp: number): string;
export function currencyExponent(code: string): number;
```

- [ ] **Step 1: Write the failing tests**

```ts
// extensions/bundle-discount/src/engine.test.ts
import { describe, expect, test } from "vitest";
import { allocate, distribute, fromMinor, toMinor, currencyExponent, type BundleEntry, type CartLineInput } from "./engine";

const L = (id: string, variantId: string, quantity: number, unitPriceMinor: number): CartLineInput => ({ id, variantId, quantity, unitPriceMinor });
const pct = (id: string, bps: number, items: [string, number][]): BundleEntry => ({ id, pricing: { kind: "percentage", basisPoints: bps }, items: items.map(([variantId, quantity]) => ({ variantId, quantity })) });
const fix = (id: string, amountMinor: number, items: [string, number][]): BundleEntry => ({ id, pricing: { kind: "fixed_amount_off", amountMinor }, items: items.map(([variantId, quantity]) => ({ variantId, quantity })) });
const total = (a: { discountMinor: number }[]) => a.reduce((s, x) => s + x.discountMinor, 0);

describe("distribute", () => {
  test("sums exactly, largest remainder, stable", () => {
    expect(distribute(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(distribute(0, [5, 5])).toEqual([0, 0]);
    expect(distribute(7, [0, 0])).toEqual([0, 0]);
  });
});

describe("money helpers", () => {
  test("string <-> minor without floats", () => {
    expect(toMinor("19.99", 2)).toBe(1999);
    expect(toMinor("20", 2)).toBe(2000);
    expect(toMinor("1500", 0)).toBe(1500);
    expect(fromMinor(1999, 2)).toBe("19.99");
    expect(fromMinor(5, 2)).toBe("0.05");
    expect(fromMinor(1500, 0)).toBe("1500");
    expect(fromMinor(1234, 3)).toBe("1.234");
  });
  test("currency exponents", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });
});

describe("fixed bundle, percentage", () => {
  const b = pct("b1", 1000, [["A", 1], ["B", 1]]);
  test("applies when all components present", () => {
    const r = allocate([b], [L("l1", "A", 1, 2000), L("l2", "B", 1, 1000)]);
    expect(total(r)).toBe(300);
    expect(r.find((x) => x.lineId === "l1")!.discountMinor).toBe(200);
  });
  test("no discount when a component is missing", () => {
    expect(allocate([b], [L("l1", "A", 1, 2000)])).toEqual([]);
  });
  test("extra units stay full price", () => {
    const r = allocate([b], [L("l1", "A", 3, 1000), L("l2", "B", 1, 1000)]);
    expect(r.find((x) => x.lineId === "l1")!.quantity).toBe(1);
    expect(total(r)).toBe(200);
  });
  test("two complete sets", () => {
    const r = allocate([b], [L("l1", "A", 2, 1000), L("l2", "B", 2, 1000)]);
    expect(total(r)).toBe(400);
  });
  test("quantity changes: 2A+1B => 1 set; remove B => none", () => {
    expect(total(allocate([b], [L("l1", "A", 2, 1000), L("l2", "B", 1, 1000)]))).toBe(200);
    expect(allocate([b], [L("l1", "A", 2, 1000)])).toEqual([]);
  });
  test("component quantity > 1", () => {
    const b2 = pct("b2", 5000, [["A", 2], ["B", 1]]);
    expect(allocate([b2], [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000)])).toEqual([]);
    expect(total(allocate([b2], [L("l1", "A", 2, 1000), L("l2", "B", 1, 1000)]))).toBe(1500);
  });
  test("duplicate product on two lines: units pooled, higher price consumed first", () => {
    const r = allocate([b], [L("l1", "A", 1, 1000), L("l2", "A", 1, 3000), L("l3", "B", 1, 1000)]);
    expect(r.map((x) => x.lineId).sort()).toEqual(["l2", "l3"]);
    expect(total(r)).toBe(400);
  });
});

describe("fixed bundle, fixed amount off", () => {
  test("fixed amount per set, clamped to subtotal", () => {
    const b = fix("f1", 500, [["A", 1], ["B", 1]]);
    expect(total(allocate([b], [L("l1", "A", 1, 2000), L("l2", "B", 1, 1000)]))).toBe(500);
    expect(total(allocate([b], [L("l1", "A", 2, 2000), L("l2", "B", 2, 1000)]))).toBe(1000);
    expect(total(allocate([b], [L("l1", "A", 1, 100), L("l2", "B", 1, 100)]))).toBe(200);
  });
  test("distribution sums exactly with odd amounts", () => {
    const b = fix("f1", 100, [["A", 1], ["B", 1], ["C", 1]]);
    const r = allocate([b], [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000), L("l3", "C", 1, 1000)]);
    expect(total(r)).toBe(100);
  });
});

describe("multiple and overlapping bundles", () => {
  test("a unit is never discounted twice", () => {
    const b1 = pct("b1", 1000, [["A", 1], ["B", 1]]);
    const b2 = pct("b2", 2000, [["A", 1], ["C", 1]]);
    const lines = [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000), L("l3", "C", 1, 1000)];
    const r = allocate([b1, b2], lines);
    expect(r.filter((x) => x.lineId === "l1")).toHaveLength(1);
    expect(r.map((x) => x.bundleId).sort()).toEqual(["b2", "b2"]); // higher saving wins; B has no partner left
  });
  test("two disjoint bundles both apply", () => {
    const b1 = pct("b1", 1000, [["A", 1], ["B", 1]]);
    const b2 = pct("b2", 1000, [["C", 1], ["D", 1]]);
    const lines = ["A", "B", "C", "D"].map((v, i) => L(`l${i}`, v, 1, 1000));
    expect(total(allocate([b1, b2], lines))).toBe(400);
  });
  test("deterministic regardless of input order", () => {
    const bs = [pct("b1", 1000, [["A", 1], ["B", 1]]), pct("b2", 1000, [["A", 1], ["C", 1]])];
    const lines = [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000), L("l3", "C", 1, 1000)];
    const a = allocate(bs, lines);
    const c = allocate([...bs].reverse(), [...lines].reverse());
    expect(c).toEqual(a);
  });
});

describe("robustness", () => {
  test("unknown pricing kind is skipped", () => {
    const b: BundleEntry = { id: "x", pricing: { kind: "fixed_price", totalMinor: 100 }, items: [{ variantId: "A", quantity: 1 }, { variantId: "B", quantity: 1 }] };
    expect(allocate([b], [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000)])).toEqual([]);
  });
  test("invalid entries are skipped (empty, qty<1, duplicate variants)", () => {
    const lines = [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000)];
    expect(allocate([pct("e", 1000, [])], lines)).toEqual([]);
    expect(allocate([pct("q", 1000, [["A", 0], ["B", 1]])], lines)).toEqual([]);
    expect(allocate([pct("d", 1000, [["A", 1], ["A", 1]])], lines)).toEqual([]);
  });
  test("200 lines stay fast", () => {
    const lines = Array.from({ length: 200 }, (_, i) => L(`l${i}`, `V${i % 20}`, 1, 1000 + i));
    const bs = Array.from({ length: 50 }, (_, i) => pct(`b${i}`, 1000, [[`V${i % 20}`, 1], [`V${(i + 1) % 20}`, 1]]));
    const t = performance.now();
    allocate(bs, lines);
    expect(performance.now() - t).toBeLessThan(200);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run extensions/bundle-discount/src/engine.test.ts`: Expected: FAIL (`./engine` not found).

- [ ] **Step 3: Implement `engine.ts`**

```ts
// extensions/bundle-discount/src/engine.ts
// Pure: no Shopify imports. Shared by the Function and the admin preview.

export type PricingModel =
  | { kind: "percentage"; basisPoints: number }
  | { kind: "fixed_amount_off"; amountMinor: number };

export interface BundleEntry {
  id: string;
  pricing: { kind: string } & Record<string, unknown>;
  items: { variantId: string; quantity: number }[];
}
export interface CartLineInput { id: string; variantId: string; quantity: number; unitPriceMinor: number }
export interface Allocation { bundleId: string; lineId: string; quantity: number; discountMinor: number }

const ZERO = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "XPF", "PYG", "RWF"]);
const THREE = new Set(["BHD", "KWD", "OMR", "JOD", "TND", "IQD", "LYD"]);
export function currencyExponent(code: string): number {
  return ZERO.has(code) ? 0 : THREE.has(code) ? 3 : 2;
}
export function toMinor(amount: string, exp: number): number {
  const [i, f = ""] = amount.split(".");
  return Number(i + (f + "0".repeat(exp)).slice(0, exp));
}
export function fromMinor(minor: number, exp: number): string {
  const s = String(minor).padStart(exp + 1, "0");
  return exp === 0 ? s : `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

/** Split `total` across `weights` proportionally; sums exactly (largest remainder, ties by index). */
export function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const base = weights.map((w) => Math.floor((total * w) / sum));
  const rems = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let left = total - base.reduce((a, b) => a + b, 0);
  rems.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && k < rems.length; k++, left--) base[rems[k].i]++;
  return base;
}

type Handler = (pricing: BundleEntry["pricing"], sets: number, subtotal: number) => number;
const handlers: Record<string, Handler> = {
  percentage: (p, _sets, subtotal) => Math.floor((subtotal * Number(p.basisPoints)) / 10000),
  fixed_amount_off: (p, sets, subtotal) => Math.min(Number(p.amountMinor) * sets, subtotal),
};

function validEntry(b: BundleEntry): boolean {
  if (!handlers[b.pricing.kind] || b.items.length === 0) return false;
  const seen = new Set<string>();
  for (const it of b.items) {
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || seen.has(it.variantId)) return false;
    seen.add(it.variantId);
  }
  const p = b.pricing;
  if (p.kind === "percentage") return Number.isInteger(p.basisPoints) && (p.basisPoints as number) > 0 && (p.basisPoints as number) <= 10000;
  if (p.kind === "fixed_amount_off") return Number.isInteger(p.amountMinor) && (p.amountMinor as number) > 0;
  return false;
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function allocate(bundles: BundleEntry[], lines: CartLineInput[]): Allocation[] {
  const remaining = new Map<string, number>();
  const byVariant = new Map<string, CartLineInput[]>();
  for (const l of lines) {
    if (l.quantity <= 0) continue;
    remaining.set(l.id, l.quantity);
    const arr = byVariant.get(l.variantId) ?? [];
    arr.push(l);
    byVariant.set(l.variantId, arr);
  }
  for (const arr of byVariant.values()) arr.sort((a, b) => b.unitPriceMinor - a.unitPriceMinor || cmp(a.id, b.id));
  const available = (v: string) => (byVariant.get(v) ?? []).reduce((s, l) => s + (remaining.get(l.id) ?? 0), 0);
  const refPrice = (v: string) => byVariant.get(v)?.[0]?.unitPriceMinor ?? 0;

  const ranked = bundles
    .filter(validEntry)
    .map((b) => {
      const perSet = b.items.reduce((s, it) => s + it.quantity * refPrice(it.variantId), 0);
      return { b, saving: handlers[b.pricing.kind](b.pricing, 1, perSet) };
    })
    .sort((x, y) => y.saving - x.saving || cmp(x.b.id, y.b.id));

  const out: Allocation[] = [];
  for (const { b } of ranked) {
    const sets = Math.min(...b.items.map((it) => Math.floor(available(it.variantId) / it.quantity)));
    if (!(sets >= 1)) continue;
    const chunks: { lineId: string; quantity: number; subtotal: number }[] = [];
    for (const it of b.items) {
      let need = sets * it.quantity;
      for (const l of byVariant.get(it.variantId) ?? []) {
        if (need === 0) break;
        const take = Math.min(remaining.get(l.id) ?? 0, need);
        if (take === 0) continue;
        remaining.set(l.id, (remaining.get(l.id) ?? 0) - take);
        chunks.push({ lineId: l.id, quantity: take, subtotal: take * l.unitPriceMinor });
        need -= take;
      }
    }
    const subtotal = chunks.reduce((s, c) => s + c.subtotal, 0);
    const totalDiscount = handlers[b.pricing.kind](b.pricing, sets, subtotal);
    const shares = distribute(totalDiscount, chunks.map((c) => c.subtotal));
    chunks.forEach((c, i) => {
      if (shares[i] > 0) out.push({ bundleId: b.id, lineId: c.lineId, quantity: c.quantity, discountMinor: shares[i] });
    });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run extensions/bundle-discount/src/engine.test.ts`: Expected: all PASS. If an expectation in the overlap test disagrees with the implementation, fix the **test arithmetic** only after re-deriving by hand (b2 saving 20% > b1 10%; b2 consumes A and C; B then has no partner).

- [ ] **Step 5: Commit**

```bash
git add extensions/bundle-discount/src/engine.ts extensions/bundle-discount/src/engine.test.ts
git commit -m "feat(engine): pure bundle allocation engine with tests"
```

---

## Task 3: Discount Function adapter

**Files:**
- Create: `extensions/bundle-discount/src/config.ts`, `extensions/bundle-discount/src/config.test.ts`, `extensions/bundle-discount/src/adapter.test.ts`, `extensions/bundle-discount/tests/*.json`
- Modify: `extensions/bundle-discount/src/cart_lines_discounts_generate_run.ts` (and `.graphql` from Task 0)

**Interfaces:**
- Consumes: Task 2 `allocate`, `toMinor`, `fromMinor`, `currencyExponent`, `BundleEntry`.
- Produces: `parseSharedConfig(raw: unknown): BundleEntry[]`; `run(input: CartInput): CartLinesDiscountsGenerateRunResult` (the entrypoint the scaffold exports; keep the scaffold's exported name).

- [ ] **Step 1: Write failing tests for config parsing and the adapter**

```ts
// extensions/bundle-discount/src/config.test.ts
import { expect, test } from "vitest";
import { parseSharedConfig } from "./config";

test("accepts v1 config", () => {
  const raw = { v: 1, bundles: [{ id: "b", pricing: { kind: "percentage", basisPoints: 1000 }, items: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }] }] };
  expect(parseSharedConfig(raw)).toHaveLength(1);
});
test.each([null, undefined, "x", { v: 2, bundles: [] }, { v: 1 }, { v: 1, bundles: "no" }])("rejects/empties %j", (raw) => {
  expect(parseSharedConfig(raw as unknown)).toEqual([]);
});
test("drops malformed bundle entries but keeps good ones", () => {
  const good = { id: "g", pricing: { kind: "percentage", basisPoints: 500 }, items: [{ variantId: "a", quantity: 1 }] };
  expect(parseSharedConfig({ v: 1, bundles: [good, { id: 5 }, null] })).toEqual([good]);
});
```
```ts
// extensions/bundle-discount/src/adapter.test.ts
import { expect, test } from "vitest";
import { buildResult } from "./cart_lines_discounts_generate_run";

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const line = (id: string, v: number, qty: number, amount: string) => ({ id, quantity: qty, cost: { amountPerQuantity: { amount, currencyCode: "USD" } }, merchandise: { __typename: "ProductVariant" as const, id: V(v) } });
const cfg = { v: 1, bundles: [{ id: "b1", pricing: { kind: "percentage", basisPoints: 1000 }, items: [{ variantId: V(1), quantity: 1 }, { variantId: V(2), quantity: 1 }] }] };

test("emits fixedAmount candidates targeting cart lines", () => {
  const r = buildResult({ cart: { lines: [line("l1", 1, 1, "20.00"), line("l2", 2, 1, "10.00")] }, discount: { discountClasses: ["PRODUCT"], metafield: { jsonValue: cfg } }, presentmentCurrencyRate: "1.0" } as any);
  const op = r.operations[0].productDiscountsAdd!;
  expect(op.selectionStrategy).toBe("ALL");
  expect(op.candidates.map((c: any) => c.value.fixedAmount.amount)).toEqual(["2.00", "1.00"]);
  expect(op.candidates[0].targets[0].cartLine).toEqual({ id: "l1", quantity: 1 });
});
test("no operations when metafield missing or class not PRODUCT", () => {
  const base = { cart: { lines: [line("l1", 1, 1, "20.00"), line("l2", 2, 1, "10.00")] }, presentmentCurrencyRate: "1.0" };
  expect(buildResult({ ...base, discount: { discountClasses: ["PRODUCT"], metafield: null } } as any).operations).toEqual([]);
  expect(buildResult({ ...base, discount: { discountClasses: ["ORDER"], metafield: { jsonValue: cfg } } } as any).operations).toEqual([]);
});
test("fixed_amount_off converts with presentment rate", () => {
  const c = { v: 1, bundles: [{ id: "f", pricing: { kind: "fixed_amount_off", amountMinor: 500 }, items: [{ variantId: V(1), quantity: 1 }, { variantId: V(2), quantity: 1 }] }] };
  const r = buildResult({ cart: { lines: [line("l1", 1, 1, "20.00"), line("l2", 2, 1, "10.00")] }, discount: { discountClasses: ["PRODUCT"], metafield: { jsonValue: c } }, presentmentCurrencyRate: "2.0" } as any);
  const sum = r.operations[0].productDiscountsAdd!.candidates.reduce((s: number, x: any) => s + Number(x.value.fixedAmount.amount), 0);
  expect(sum).toBeCloseTo(10.0, 2);
});
```
Run: `npx vitest run extensions/bundle-discount`: Expected: FAIL.

- [ ] **Step 2: Implement `config.ts`**

```ts
// extensions/bundle-discount/src/config.ts
import type { BundleEntry } from "./engine";

export const CONFIG_VERSION = 1;

function isEntry(x: unknown): x is BundleEntry {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, any>;
  return (
    typeof b.id === "string" &&
    !!b.pricing && typeof b.pricing.kind === "string" &&
    Array.isArray(b.items) &&
    b.items.every((i: any) => i && typeof i.variantId === "string" && typeof i.quantity === "number")
  );
}

export function parseSharedConfig(raw: unknown): BundleEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const c = raw as Record<string, unknown>;
  if (c.v !== CONFIG_VERSION || !Array.isArray(c.bundles)) return [];
  return c.bundles.filter(isEntry);
}
```

- [ ] **Step 3: Implement the entrypoint** (match the scaffold's generated import names after `typegen`; shown with the TypeScript template's names)

```ts
// extensions/bundle-discount/src/cart_lines_discounts_generate_run.ts
import { DiscountClass, ProductDiscountSelectionStrategy } from "../generated/api";
import type { CartInput, CartLinesDiscountsGenerateRunResult } from "../generated/api";
import { parseSharedConfig } from "./config";
import { allocate, currencyExponent, fromMinor, toMinor, type BundleEntry, type CartLineInput } from "./engine";

export function buildResult(input: CartInput): CartLinesDiscountsGenerateRunResult {
  const empty = { operations: [] };
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) return empty;
  const bundles = parseSharedConfig(input.discount.metafield?.jsonValue);
  if (bundles.length === 0) return empty;

  const rate = Number((input as any).presentmentCurrencyRate ?? "1") || 1;
  const currency = input.cart.lines[0]?.cost.amountPerQuantity.currencyCode ?? "USD";
  const exp = currencyExponent(currency);

  const lines: CartLineInput[] = [];
  for (const l of input.cart.lines) {
    if (l.merchandise.__typename !== "ProductVariant") continue;
    lines.push({ id: l.id, variantId: l.merchandise.id, quantity: l.quantity, unitPriceMinor: toMinor(l.cost.amountPerQuantity.amount, exp) });
  }

  // Fixed amounts are stored in shop-currency minor units; convert to presentment.
  const entries: BundleEntry[] = bundles.map((b) =>
    b.pricing.kind === "fixed_amount_off"
      ? { ...b, pricing: { ...b.pricing, amountMinor: Math.round(Number(b.pricing.amountMinor) * rate) } }
      : b,
  );

  const allocations = allocate(entries, lines);
  if (allocations.length === 0) return empty;
  return {
    operations: [
      {
        productDiscountsAdd: {
          selectionStrategy: ProductDiscountSelectionStrategy.All,
          candidates: allocations.map((a) => ({
            message: "Bundle discount",
            targets: [{ cartLine: { id: a.lineId, quantity: a.quantity } }],
            value: { fixedAmount: { amount: fromMinor(a.discountMinor, exp), appliesToEachItem: false } },
          })),
        },
      },
    ],
  };
}

// Entry name must match the export in shopify.extension.toml ("cart_lines_discounts_generate_run").
export function cartLinesDiscountsGenerateRun(input: CartInput): CartLinesDiscountsGenerateRunResult {
  return buildResult(input);
}
```
If `presentmentCurrencyRate` is not at the Input root in the 2026-07 schema (check `extensions/bundle-discount/schema.graphql`), add it to the query where the schema defines it and adjust the property path; do not guess: grep the schema.

- [ ] **Step 4: Run tests, build, and run a fixture**

Run: `npx vitest run extensions/bundle-discount`: Expected: PASS.
Run: `cd extensions/bundle-discount && npm exec shopify app function build`: Expected: build succeeds; note the wasm size.
Create `extensions/bundle-discount/tests/two-items.input.json` with the same cart as the first adapter test (metafield `jsonValue` inline, `presentmentCurrencyRate:"1.0"`) and run:
`npm exec shopify app function run -- --input tests/two-items.input.json --export cart_lines_discounts_generate_run`
Expected: JSON with two `fixedAmount` candidates `2.00`/`1.00`. Record the reported instruction count in the commit message; if it exceeds 50% of 11 M for the 200-line fixture, escalate to the owner (Rust swap).

- [ ] **Step 5: Commit**

```bash
git add extensions/bundle-discount
git commit -m "feat(function): shared bundle discount function using allocation engine"
```

---

## Task 4: Validation, strategy, shared config, repository (isolation tests)

**Files:**
- Create: `app/bundles/types.ts`, `app/bundles/validation.ts`, `app/bundles/strategies/index.ts`, `app/bundles/strategies/fixed.ts`, `app/bundles/config.ts`, `app/bundles/repo.server.ts`
- Test: `tests/validation.test.ts`, `tests/config.test.ts`, `tests/repo.test.ts`, `tests/noDirectPrisma.test.ts`

**Interfaces:**
- Consumes: Task 1 `createTestPrisma/resetTestDb`; Task 2 `BundleEntry`.
- Produces (exact):
```ts
// types.ts
export type BundleStatus = "draft" | "active" | "paused" | "archived";
export type PricingKind = "percentage" | "fixed_amount_off";
export interface BundleItemInput { productId: string; variantId: string; quantity: number }
export interface BundleInput { name: string; description?: string; status: BundleStatus; pricingKind: PricingKind; pricingValue: number; items: BundleItemInput[] }
export interface StoredBundle { id: string; shop: string; name: string; description: string | null; type: string; status: BundleStatus; pricingKind: PricingKind; pricingValue: number; currencyCode: string; syncStatus: string; syncError: string | null; version: number; createdAt: Date; updatedAt: Date; items: (BundleItemInput & { id: string; position: number })[] }
// validation.ts
export const bundleInputSchema: z.ZodType<BundleInput>
export function parseBundleInput(raw: unknown): BundleInput  // throws ZodError
// config.ts
export const CONFIG_NAMESPACE: string; export const CONFIG_KEY = "function-configuration"; export const MAX_CONFIG_BYTES = 65536;
export function buildSharedConfig(bundles: StoredBundle[]): { v: 1; bundles: BundleEntry[] }
export function serializeSharedConfig(bundles: StoredBundle[]): { json: string; hash: string }  // throws ConfigTooLargeError
// repo.server.ts
export function createBundleRepo(prisma: PrismaClient): BundleRepo
interface BundleRepo {
  list(shop: string, opts?: { status?: BundleStatus; search?: string; sort?: "updatedAt" | "name"; dir?: "asc" | "desc" }): Promise<StoredBundle[]>;
  get(shop: string, id: string): Promise<StoredBundle | null>;
  create(shop: string, currencyCode: string, input: BundleInput): Promise<StoredBundle>;
  update(shop: string, id: string, expectedVersion: number, input: BundleInput): Promise<StoredBundle | "conflict" | null>;
  setStatus(shop: string, id: string, status: BundleStatus): Promise<StoredBundle | null>;
  duplicate(shop: string, id: string): Promise<StoredBundle | null>;
  activeForShop(shop: string): Promise<StoredBundle[]>;
  markSync(shop: string, ids: string[], status: "synced" | "error", error?: string): Promise<void>;
  deleteAllForShop(shop: string): Promise<void>;
  countsByStatus(shop: string): Promise<Record<BundleStatus, number>>;
  variantsInUse(shop: string, variantIds: string[], excludeBundleId?: string): Promise<string[]>;
}
```
(`CONFIG_NAMESPACE` default `"$app"`; set to the Task 0 result.)

- [ ] **Step 1: Failing validation tests**

```ts
// tests/validation.test.ts
import { expect, test } from "vitest";
import { parseBundleInput } from "../app/bundles/validation";

const ok = { name: "Duo", status: "draft", pricingKind: "percentage", pricingValue: 1000, items: [
  { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 },
  { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 2 } ] };

test("accepts valid input", () => expect(parseBundleInput(ok).items).toHaveLength(2));
test("needs >= 2 distinct variants", () => {
  expect(() => parseBundleInput({ ...ok, items: [ok.items[0]] })).toThrow();
  expect(() => parseBundleInput({ ...ok, items: [ok.items[0], ok.items[0]] })).toThrow();
});
test("max 10 components", () => {
  const items = Array.from({ length: 11 }, (_, i) => ({ productId: `gid://shopify/Product/${i}`, variantId: `gid://shopify/ProductVariant/${i}`, quantity: 1 }));
  expect(() => parseBundleInput({ ...ok, items })).toThrow();
});
test("pricing bounds", () => {
  expect(() => parseBundleInput({ ...ok, pricingValue: 0 })).toThrow();
  expect(() => parseBundleInput({ ...ok, pricingValue: 10001 })).toThrow();
  expect(() => parseBundleInput({ ...ok, pricingKind: "fixed_amount_off", pricingValue: 0 })).toThrow();
  expect(parseBundleInput({ ...ok, pricingKind: "fixed_amount_off", pricingValue: 500 }).pricingValue).toBe(500);
});
test("rejects bad ids, quantity, status, name", () => {
  expect(() => parseBundleInput({ ...ok, items: [{ ...ok.items[0], variantId: "x" }, ok.items[1]] })).toThrow();
  expect(() => parseBundleInput({ ...ok, items: [{ ...ok.items[0], quantity: 0 }, ok.items[1]] })).toThrow();
  expect(() => parseBundleInput({ ...ok, status: "live" })).toThrow();
  expect(() => parseBundleInput({ ...ok, name: " " })).toThrow();
});
```
Run: `npx vitest run tests/validation.test.ts`: Expected: FAIL.

- [ ] **Step 2: Implement `types.ts` (from Interfaces above) and `validation.ts`**

```ts
// app/bundles/validation.ts
import { z } from "zod";
import type { BundleInput } from "./types";

const variantGid = z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/);
const productGid = z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/);

export const bundleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    status: z.enum(["draft", "active", "paused", "archived"]),
    pricingKind: z.enum(["percentage", "fixed_amount_off"]),
    pricingValue: z.number().int().positive(),
    items: z
      .array(z.object({ productId: productGid, variantId: variantGid, quantity: z.number().int().min(1).max(99) }))
      .min(2)
      .max(10),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.variantId)).size !== v.items.length)
      ctx.addIssue({ code: "custom", path: ["items"], message: "Each variant can appear only once" });
    if (v.pricingKind === "percentage" && v.pricingValue > 10000)
      ctx.addIssue({ code: "custom", path: ["pricingValue"], message: "Percentage must be 0.01–100" });
  }) satisfies z.ZodType<BundleInput>;

export const parseBundleInput = (raw: unknown): BundleInput => bundleInputSchema.parse(raw);
```
Run the test: Expected: PASS.

- [ ] **Step 3: Failing tests for shared config**

```ts
// tests/config.test.ts
import { expect, test } from "vitest";
import { buildSharedConfig, serializeSharedConfig, MAX_CONFIG_BYTES } from "../app/bundles/config";
import type { StoredBundle } from "../app/bundles/types";

const mk = (id: string, n = 2): StoredBundle => ({ id, shop: "a.myshopify.com", name: id, description: null, type: "fixed", status: "active", pricingKind: "percentage", pricingValue: 1000, currencyCode: "USD", syncStatus: "pending", syncError: null, version: 1, createdAt: new Date(), updatedAt: new Date(),
  items: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, productId: `gid://shopify/Product/${i}`, variantId: `gid://shopify/ProductVariant/${i}`, quantity: 1, position: i })) });

test("builds v1 entries with only needed fields", () => {
  const c = buildSharedConfig([mk("b1")]);
  expect(c).toEqual({ v: 1, bundles: [{ id: "b1", pricing: { kind: "percentage", basisPoints: 1000 }, items: [{ variantId: "gid://shopify/ProductVariant/0", quantity: 1 }, { variantId: "gid://shopify/ProductVariant/1", quantity: 1 }] }] });
});
test("fixed amount maps to amountMinor", () => {
  const b = { ...mk("f"), pricingKind: "fixed_amount_off" as const, pricingValue: 500 };
  expect(buildSharedConfig([b]).bundles[0].pricing).toEqual({ kind: "fixed_amount_off", amountMinor: 500 });
});
test("hash is stable and order-independent", () => {
  const a = serializeSharedConfig([mk("b1"), mk("b2")]);
  const b = serializeSharedConfig([mk("b2"), mk("b1")]);
  expect(a.hash).toBe(b.hash);
});
test("rejects configs over budget", () => {
  const many = Array.from({ length: 400 }, (_, i) => mk(`bundle-${i}`, 10));
  expect(() => serializeSharedConfig(many)).toThrow(/64/);
  expect(MAX_CONFIG_BYTES).toBe(65536);
});
```
Run: Expected FAIL.

- [ ] **Step 4: Implement `config.ts`, `strategies/*`**

```ts
// app/bundles/config.ts
import { createHash } from "node:crypto";
import type { BundleEntry } from "../../extensions/bundle-discount/src/engine";
import { getStrategy } from "./strategies";
import type { StoredBundle } from "./types";

export const CONFIG_NAMESPACE = "$app"; // set to the Task 0 / S2 result
export const CONFIG_KEY = "function-configuration";
export const MAX_CONFIG_BYTES = 65536;

export class ConfigTooLargeError extends Error {
  constructor(bytes: number) { super(`Bundle configuration is ${bytes} bytes; the limit is 64 KB. Archive or simplify bundles.`); }
}

export function buildSharedConfig(bundles: StoredBundle[]): { v: 1; bundles: BundleEntry[] } {
  const sorted = [...bundles].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { v: 1, bundles: sorted.map((b) => getStrategy(b.type).toSharedEntry(b)) };
}

export function serializeSharedConfig(bundles: StoredBundle[]): { json: string; hash: string } {
  const json = JSON.stringify(buildSharedConfig(bundles));
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_CONFIG_BYTES) throw new ConfigTooLargeError(bytes);
  return { json, hash: createHash("sha256").update(json).digest("hex") };
}
```
```ts
// app/bundles/strategies/fixed.ts
import type { BundleEntry } from "../../../extensions/bundle-discount/src/engine";
import { parseBundleInput } from "../validation";
import type { BundleInput, StoredBundle } from "../types";

export interface BundleStrategy {
  key: string;
  validate(input: unknown): BundleInput;
  toSharedEntry(bundle: StoredBundle): BundleEntry;
}

export const fixedStrategy: BundleStrategy = {
  key: "fixed",
  validate: parseBundleInput,
  toSharedEntry(b) {
    const pricing =
      b.pricingKind === "percentage"
        ? { kind: "percentage", basisPoints: b.pricingValue }
        : { kind: "fixed_amount_off", amountMinor: b.pricingValue };
    return { id: b.id, pricing, items: [...b.items].sort((x, y) => x.position - y.position).map((i) => ({ variantId: i.variantId, quantity: i.quantity })) };
  },
};
```
```ts
// app/bundles/strategies/index.ts
import { fixedStrategy, type BundleStrategy } from "./fixed";
const registry: Record<string, BundleStrategy> = { fixed: fixedStrategy };
// Future types (mix_and_match, volume, bxgy, fbt, tiered) register here; fixed_price is a new pricing kind.
export function getStrategy(key: string): BundleStrategy {
  const s = registry[key];
  if (!s) throw new Error(`Unknown bundle type: ${key}`);
  return s;
}
export type { BundleStrategy };
```
Run `npx vitest run tests/config.test.ts`: Expected PASS.

- [ ] **Step 5: Failing repo isolation tests**

```ts
// tests/repo.test.ts
import { beforeEach, describe, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createTestPrisma, resetTestDb } from "./testDb";
import type { BundleInput } from "../app/bundles/types";

const A = "a.myshopify.com", B = "b.myshopify.com";
const input = (name: string, over: Partial<BundleInput> = {}): BundleInput => ({ name, status: "active", pricingKind: "percentage", pricingValue: 1000,
  items: [{ productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 1 }], ...over });

let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => { const p = await createTestPrisma(); await resetTestDb(p); repo = createBundleRepo(p); });

describe("shop isolation", () => {
  test("get/update/setStatus/duplicate never cross shops", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    expect(await repo.get(B, a.id)).toBeNull();
    expect(await repo.update(B, a.id, 1, input("Hacked"))).toBeNull();
    expect(await repo.setStatus(B, a.id, "archived")).toBeNull();
    expect(await repo.duplicate(B, a.id)).toBeNull();
    expect((await repo.get(A, a.id))!.name).toBe("Duo");
  });
  test("list, counts, activeForShop, variantsInUse are scoped", async () => {
    await repo.create(A, "USD", input("Duo"));
    await repo.create(B, "USD", input("Other"));
    expect((await repo.list(A)).map((b) => b.name)).toEqual(["Duo"]);
    expect((await repo.countsByStatus(A)).active).toBe(1);
    expect(await repo.activeForShop(B)).toHaveLength(1);
    expect(await repo.variantsInUse(A, ["gid://shopify/ProductVariant/1"])).toEqual(["gid://shopify/ProductVariant/1"]);
    await repo.deleteAllForShop(A);
    expect(await repo.list(A)).toEqual([]);
    expect(await repo.list(B)).toHaveLength(1);
  });
  test("same name allowed in different shops, not within one", async () => {
    await repo.create(A, "USD", input("Duo"));
    await repo.create(B, "USD", input("Duo"));
    await expect(repo.create(A, "USD", input("Duo"))).rejects.toThrow();
  });
});

describe("behaviour", () => {
  test("optimistic concurrency", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    const u = await repo.update(A, a.id, 1, input("Duo2"));
    expect(u).not.toBe("conflict");
    expect((u as any).version).toBe(2);
    expect(await repo.update(A, a.id, 1, input("Stale"))).toBe("conflict");
  });
  test("update replaces items atomically", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    const u = (await repo.update(A, a.id, 1, input("Duo", { items: [
      { productId: "gid://shopify/Product/3", variantId: "gid://shopify/ProductVariant/3", quantity: 2 },
      { productId: "gid://shopify/Product/4", variantId: "gid://shopify/ProductVariant/4", quantity: 1 } ] }))) as any;
    expect(u.items.map((i: any) => i.variantId)).toEqual(["gid://shopify/ProductVariant/3", "gid://shopify/ProductVariant/4"]);
  });
  test("duplicate creates a draft copy with a unique name", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    const d = (await repo.duplicate(A, a.id))!;
    expect(d.status).toBe("draft");
    expect(d.name).toBe("Duo (copy)");
    expect(d.items).toHaveLength(2);
    const d2 = (await repo.duplicate(A, a.id))!;
    expect(d2.name).toBe("Duo (copy 2)");
  });
  test("search and sort", async () => {
    await repo.create(A, "USD", input("Zeta"));
    await repo.create(A, "USD", input("Alpha"));
    expect((await repo.list(A, { sort: "name", dir: "asc" })).map((b) => b.name)).toEqual(["Alpha", "Zeta"]);
    expect((await repo.list(A, { search: "alp" })).map((b) => b.name)).toEqual(["Alpha"]);
  });
  test("variantsInUse ignores archived/draft and the excluded bundle", async () => {
    const a = await repo.create(A, "USD", input("Duo"));
    expect(await repo.variantsInUse(A, ["gid://shopify/ProductVariant/1"], a.id)).toEqual([]);
    await repo.setStatus(A, a.id, "archived");
    expect(await repo.variantsInUse(A, ["gid://shopify/ProductVariant/1"])).toEqual([]);
  });
});
```
```ts
// tests/noDirectPrisma.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

test("only repo.server.ts touches bundle tables", () => {
  const offenders = walk("app").filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !f.endsWith("repo.server.ts") && /\.(bundle|bundleItem|bundleEvent)\./.test(readFileSync(f, "utf8").replace(/\s+/g, "")) && /prisma|db\./.test(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});
```
Run: Expected FAIL.

- [ ] **Step 6: Implement `repo.server.ts`**

```ts
// app/bundles/repo.server.ts
import type { Prisma, PrismaClient } from "@prisma/client";
import type { BundleInput, BundleStatus, StoredBundle } from "./types";

const include = { items: { orderBy: { position: "asc" as const } } };
type Row = Prisma.BundleGetPayload<{ include: typeof include }>;
const map = (r: Row): StoredBundle => ({ ...r, status: r.status as BundleStatus, pricingKind: r.pricingKind as StoredBundle["pricingKind"], items: r.items.map((i) => ({ id: i.id, productId: i.productId, variantId: i.variantId, quantity: i.quantity, position: i.position })) });

export function createBundleRepo(prisma: PrismaClient) {
  const itemsData = (shop: string, input: BundleInput) => input.items.map((i, position) => ({ shop, position, productId: i.productId, variantId: i.variantId, quantity: i.quantity }));

  return {
    async list(shop: string, opts: { status?: BundleStatus; search?: string; sort?: "updatedAt" | "name"; dir?: "asc" | "desc" } = {}) {
      const rows = await prisma.bundle.findMany({
        where: { shop, ...(opts.status ? { status: opts.status } : {}), ...(opts.search ? { name: { contains: opts.search } } : {}) },
        orderBy: { [opts.sort ?? "updatedAt"]: opts.dir ?? "desc" },
        include,
      });
      return rows.map(map);
    },
    async get(shop: string, id: string) {
      const r = await prisma.bundle.findFirst({ where: { id, shop }, include });
      return r ? map(r) : null;
    },
    async create(shop: string, currencyCode: string, input: BundleInput) {
      const r = await prisma.bundle.create({
        data: { shop, currencyCode, name: input.name, description: input.description ?? null, status: input.status, pricingKind: input.pricingKind, pricingValue: input.pricingValue, items: { create: itemsData(shop, input) } },
        include,
      });
      return map(r);
    },
    async update(shop: string, id: string, expectedVersion: number, input: BundleInput) {
      return prisma.$transaction(async (tx) => {
        const res = await tx.bundle.updateMany({
          where: { id, shop, version: expectedVersion },
          data: { name: input.name, description: input.description ?? null, status: input.status, pricingKind: input.pricingKind, pricingValue: input.pricingValue, version: { increment: 1 }, syncStatus: "pending", syncError: null },
        });
        if (res.count === 0) return (await tx.bundle.findFirst({ where: { id, shop } })) ? ("conflict" as const) : null;
        await tx.bundleItem.deleteMany({ where: { bundleId: id, shop } });
        await tx.bundleItem.createMany({ data: itemsData(shop, input).map((d) => ({ ...d, bundleId: id })) });
        return map((await tx.bundle.findFirstOrThrow({ where: { id, shop }, include })));
      });
    },
    async setStatus(shop: string, id: string, status: BundleStatus) {
      const res = await prisma.bundle.updateMany({ where: { id, shop }, data: { status, version: { increment: 1 }, syncStatus: "pending", syncError: null } });
      return res.count ? map(await prisma.bundle.findFirstOrThrow({ where: { id, shop }, include })) : null;
    },
    async duplicate(shop: string, id: string) {
      const src = await prisma.bundle.findFirst({ where: { id, shop }, include });
      if (!src) return null;
      const names = new Set((await prisma.bundle.findMany({ where: { shop }, select: { name: true } })).map((n) => n.name));
      let name = `${src.name} (copy)`;
      for (let n = 2; names.has(name); n++) name = `${src.name} (copy ${n})`;
      const r = await prisma.bundle.create({
        data: { shop, name, description: src.description, type: src.type, status: "draft", pricingKind: src.pricingKind, pricingValue: src.pricingValue, currencyCode: src.currencyCode,
          items: { create: src.items.map((i) => ({ shop, position: i.position, productId: i.productId, variantId: i.variantId, quantity: i.quantity })) } },
        include,
      });
      return map(r);
    },
    async activeForShop(shop: string) {
      return (await prisma.bundle.findMany({ where: { shop, status: "active" }, include })).map(map);
    },
    async markSync(shop: string, ids: string[], status: "synced" | "error", error?: string) {
      await prisma.bundle.updateMany({ where: { shop, id: { in: ids } }, data: { syncStatus: status, syncError: error ?? null } });
    },
    async deleteAllForShop(shop: string) {
      await prisma.$transaction([
        prisma.bundleItem.deleteMany({ where: { shop } }),
        prisma.bundleEvent.deleteMany({ where: { shop } }),
        prisma.bundle.deleteMany({ where: { shop } }),
        prisma.shopDiscount.deleteMany({ where: { shop } }),
      ]);
    },
    async countsByStatus(shop: string) {
      const g = await prisma.bundle.groupBy({ by: ["status"], where: { shop }, _count: { _all: true } });
      const out: Record<BundleStatus, number> = { draft: 0, active: 0, paused: 0, archived: 0 };
      for (const r of g) out[r.status as BundleStatus] = r._count._all;
      return out;
    },
    async variantsInUse(shop: string, variantIds: string[], excludeBundleId?: string) {
      const rows = await prisma.bundleItem.findMany({
        where: { shop, variantId: { in: variantIds }, bundle: { status: "active", ...(excludeBundleId ? { id: { not: excludeBundleId } } : {}) } },
        select: { variantId: true },
      });
      return [...new Set(rows.map((r) => r.variantId))];
    },
  };
}
export type BundleRepo = ReturnType<typeof createBundleRepo>;
```
Add `app/bundles/index.server.ts`: `import prisma from "../db.server"; export const bundleRepo = createBundleRepo(prisma);` (the `.server` suffix keeps it out of the client bundle).

Note: `shopDiscount` is also keyed by `shop`; `ShopDiscount` accessors live in `sync.server.ts` (Task 5), which uses an injected prisma; the `noDirectPrisma` test only forbids bundle tables.

- [ ] **Step 7: Run all, typecheck, commit**

Run: `npm test && npm run typecheck`: Expected PASS.
```bash
git add app/bundles tests && git commit -m "feat(bundles): validation, strategy registry, shared config, shop-scoped repo"
```

---

## Task 5: Shopify discount wrappers and idempotent sync

**Files:**
- Create: `app/bundles/shopifyDiscount.server.ts`, `app/bundles/sync.server.ts`
- Test: `tests/sync.test.ts`
- Modify: `shopify.app.toml` (scopes)

**Interfaces:**
- Consumes: Task 4 `serializeSharedConfig`, `ConfigTooLargeError`, `CONFIG_NAMESPACE`, `CONFIG_KEY`, `BundleRepo`.
- Produces:
```ts
export interface DiscountGateway {
  create(configJson: string): Promise<{ discountId: string }>;                 // throws ShopifyUserError
  update(discountId: string, configJson: string): Promise<void>;
  setActive(discountId: string, active: boolean): Promise<void>;
  inspect(discountId: string): Promise<{ status: string; configHash: string | null } | null>;
}
export class ShopifyUserError extends Error {}
export function adminDiscountGateway(admin: { graphql: (q: string, o?: { variables?: unknown }) => Promise<Response> }): DiscountGateway
export async function syncShop(deps: { shop: string; prisma: PrismaClient; repo: BundleRepo; gateway: DiscountGateway }): Promise<{ status: "noop" | "created" | "updated" | "deactivated" | "error"; message?: string }>
```

- [ ] **Step 1: Failing sync tests with a fake gateway**

```ts
// tests/sync.test.ts
import { beforeEach, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { syncShop, ShopifyUserError, type DiscountGateway } from "../app/bundles/sync.server";
import { createTestPrisma, resetTestDb } from "./testDb";
import type { BundleInput } from "../app/bundles/types";

const S = "a.myshopify.com";
const input = (name: string, v1 = 1, v2 = 2): BundleInput => ({ name, status: "active", pricingKind: "percentage", pricingValue: 1000, items: [
  { productId: `gid://shopify/Product/${v1}`, variantId: `gid://shopify/ProductVariant/${v1}`, quantity: 1 }, { productId: `gid://shopify/Product/${v2}`, variantId: `gid://shopify/ProductVariant/${v2}`, quantity: 1 }] });

function fake() {
  const calls: string[] = [];
  const g: DiscountGateway & { calls: string[]; fail?: string } = {
    calls,
    async create() { calls.push("create"); if (g.fail) throw new ShopifyUserError(g.fail); return { discountId: "gid://shopify/DiscountAutomaticNode/1" }; },
    async update() { calls.push("update"); if (g.fail) throw new ShopifyUserError(g.fail); },
    async setActive(_id, a) { calls.push(a ? "activate" : "deactivate"); },
    async inspect() { return null; },
  };
  return g;
}
let prisma: Awaited<ReturnType<typeof createTestPrisma>>, repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => { prisma = await createTestPrisma(); await resetTestDb(prisma); repo = createBundleRepo(prisma); });

test("first sync creates one shared discount; same config is a no-op", async () => {
  await repo.create(S, "USD", input("A"));
  await repo.create(S, "USD", input("B", 3, 4));
  const g = fake();
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("created");
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("noop");
  expect(g.calls).toEqual(["create"]);
  expect((await repo.list(S)).every((b) => b.syncStatus === "synced")).toBe(true);
});
test("config change updates the same discount id", async () => {
  await repo.create(S, "USD", input("A"));
  const g = fake();
  await syncShop({ shop: S, prisma, repo, gateway: g });
  await repo.create(S, "USD", input("B", 3, 4));
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("updated");
  expect(g.calls).toEqual(["create", "update"]);
});
test("zero active bundles deactivates, then reactivation updates and activates", async () => {
  const a = await repo.create(S, "USD", input("A"));
  const g = fake();
  await syncShop({ shop: S, prisma, repo, gateway: g });
  await repo.setStatus(S, a.id, "paused");
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("deactivated");
  await repo.setStatus(S, a.id, "active");
  await syncShop({ shop: S, prisma, repo, gateway: g });
  expect(g.calls).toEqual(["create", "deactivate", "activate", "update"]);
});
test("nothing active and no discount yet: noop, no Shopify call", async () => {
  const g = fake();
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("noop");
  expect(g.calls).toEqual([]);
});
test("Shopify userErrors mark bundles error and are retryable", async () => {
  const a = await repo.create(S, "USD", input("A"));
  const g = fake(); g.fail = "Function not found";
  const r = await syncShop({ shop: S, prisma, repo, gateway: g });
  expect(r.status).toBe("error");
  const b = (await repo.get(S, a.id))!;
  expect(b.syncStatus).toBe("error");
  expect(b.syncError).toContain("Function not found");
  g.fail = undefined;
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("created");
});
test("over-budget config is reported, not sent", async () => {
  const wide = (name: string): BundleInput => ({ name, status: "active", pricingKind: "percentage", pricingValue: 1000,
    items: Array.from({ length: 10 }, (_, i) => ({ productId: `gid://shopify/Product/${100000 + i}`, variantId: `gid://shopify/ProductVariant/${100000 + i}`, quantity: 1 })) });
  for (let i = 0; i < 120; i++) await repo.create(S, "USD", wide(`Bundle number ${i}`));
  const g = fake();
  const r = await syncShop({ shop: S, prisma, repo, gateway: g });
  expect(r.status).toBe("error");
  expect(r.message).toMatch(/64 KB/);
  expect(g.calls).toEqual([]);
});
test("sync is scoped per shop", async () => {
  await repo.create("b.myshopify.com", "USD", input("Other"));
  const g = fake();
  expect((await syncShop({ shop: S, prisma, repo, gateway: g })).status).toBe("noop");
});
```
Run: Expected FAIL.

- [ ] **Step 2: Implement `sync.server.ts`**

```ts
// app/bundles/sync.server.ts
import type { PrismaClient } from "@prisma/client";
import { ConfigTooLargeError, serializeSharedConfig } from "./config";
import type { BundleRepo } from "./repo.server";

export class ShopifyUserError extends Error {}
export interface DiscountGateway {
  create(configJson: string): Promise<{ discountId: string }>;
  update(discountId: string, configJson: string): Promise<void>;
  setActive(discountId: string, active: boolean): Promise<void>;
  inspect(discountId: string): Promise<{ status: string; configHash: string | null } | null>;
}
type Result = { status: "noop" | "created" | "updated" | "deactivated" | "error"; message?: string };

export async function syncShop(d: { shop: string; prisma: PrismaClient; repo: BundleRepo; gateway: DiscountGateway }): Promise<Result> {
  const { shop, prisma, repo, gateway } = d;
  const active = await repo.activeForShop(shop);
  const ids = active.map((b) => b.id);
  const row = await prisma.shopDiscount.findUnique({ where: { shop } });

  try {
    if (active.length === 0) {
      if (!row?.shopifyDiscountId || row.configHash === "inactive") return { status: "noop" };
      await gateway.setActive(row.shopifyDiscountId, false);
      await prisma.shopDiscount.update({ where: { shop }, data: { configHash: "inactive", syncedAt: new Date() } });
      return { status: "deactivated" };
    }
    const { json, hash } = serializeSharedConfig(active);
    if (row?.configHash === hash) {
      await repo.markSync(shop, ids, "synced");
      return { status: "noop" };
    }
    if (!row?.shopifyDiscountId) {
      const { discountId } = await gateway.create(json);
      await prisma.shopDiscount.upsert({ where: { shop }, create: { shop, shopifyDiscountId: discountId, configHash: hash, syncedAt: new Date() }, update: { shopifyDiscountId: discountId, configHash: hash, syncedAt: new Date() } });
      await repo.markSync(shop, ids, "synced");
      return { status: "created" };
    }
    if (row.configHash === "inactive") await gateway.setActive(row.shopifyDiscountId, true);
    await gateway.update(row.shopifyDiscountId, json);
    await prisma.shopDiscount.update({ where: { shop }, data: { configHash: hash, syncedAt: new Date() } });
    await repo.markSync(shop, ids, "synced");
    return { status: "updated" };
  } catch (e) {
    const message = e instanceof ShopifyUserError || e instanceof ConfigTooLargeError ? e.message : "Unexpected error while syncing; try again.";
    if (!(e instanceof ShopifyUserError || e instanceof ConfigTooLargeError)) console.error(JSON.stringify({ evt: "sync_failed", shop, err: (e as Error).name }));
    await repo.markSync(shop, ids, "error", message);
    return { status: "error", message };
  }
}
```
Note the test order: create → deactivate → (reactivate) `activate` then `update`. Matches the code path.

- [ ] **Step 3: Implement the Admin gateway** (validate each GraphQL string with the skill validator, `--api admin --version 2026-07`; fix reported fields, especially whether `metafields` is accepted in `discountAutomaticAppUpdate` and whether update needs `id`-based metafield input. Record S2 findings.)

```ts
// app/bundles/shopifyDiscount.server.ts
import { CONFIG_KEY, CONFIG_NAMESPACE } from "./config";
import { ShopifyUserError, type DiscountGateway } from "./sync.server";

type Admin = { graphql: (q: string, o?: { variables?: unknown }) => Promise<Response> };

const COMBINES = { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true };
const FUNCTION_HANDLE = "bundle-discount";

const CREATE = `#graphql
mutation CreateSharedBundleDiscount($input: DiscountAutomaticAppInput!) {
  discountAutomaticAppCreate(automaticAppDiscount: $input) {
    automaticAppDiscount { discountId }
    userErrors { field message code }
  }
}`;
const UPDATE = `#graphql
mutation UpdateSharedBundleDiscount($id: ID!, $input: DiscountAutomaticAppInput!) {
  discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $input) {
    automaticAppDiscount { discountId }
    userErrors { field message code }
  }
}`;
const ACTIVATE = `#graphql
mutation ActivateBundleDiscount($id: ID!) { discountAutomaticActivate(id: $id) { userErrors { field message } } }`;
const DEACTIVATE = `#graphql
mutation DeactivateBundleDiscount($id: ID!) { discountAutomaticDeactivate(id: $id) { userErrors { field message } } }`;
const INSPECT = `#graphql
query InspectBundleDiscount($id: ID!, $ns: String!, $key: String!) {
  discountNode(id: $id) {
    discount { __typename ... on DiscountAutomaticApp { status } }
    metafield(namespace: $ns, key: $key) { value }
  }
}`;

async function call(admin: Admin, query: string, variables: unknown) {
  const res = await admin.graphql(query, { variables });
  const body = (await res.json()) as { data?: any; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`Shopify GraphQL error: ${body.errors[0].message}`);
  return body.data;
}
function assertNoUserErrors(errs?: { message: string }[]) {
  if (errs?.length) throw new ShopifyUserError(errs.map((e) => e.message).join("; "));
}
const input = (configJson: string, extra: object = {}) => ({
  title: "MobiBundler bundles",
  functionHandle: FUNCTION_HANDLE,
  discountClasses: ["PRODUCT"],
  combinesWith: COMBINES,
  metafields: [{ namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value: configJson }],
  ...extra,
});

export function adminDiscountGateway(admin: Admin): DiscountGateway {
  return {
    async create(configJson) {
      const d = await call(admin, CREATE, { input: input(configJson, { startsAt: new Date().toISOString() }) });
      assertNoUserErrors(d.discountAutomaticAppCreate.userErrors);
      return { discountId: d.discountAutomaticAppCreate.automaticAppDiscount.discountId };
    },
    async update(id, configJson) {
      const d = await call(admin, UPDATE, { id, input: input(configJson) });
      assertNoUserErrors(d.discountAutomaticAppUpdate.userErrors);
    },
    async setActive(id, active) {
      const d = await call(admin, active ? ACTIVATE : DEACTIVATE, { id });
      assertNoUserErrors((active ? d.discountAutomaticActivate : d.discountAutomaticDeactivate).userErrors);
    },
    async inspect(id) {
      const d = await call(admin, INSPECT, { id, ns: CONFIG_NAMESPACE, key: CONFIG_KEY });
      if (!d.discountNode) return null;
      return { status: d.discountNode.discount?.status ?? "UNKNOWN", configHash: d.discountNode.metafield?.value ?? null };
    },
  };
}
```
(`inspect().configHash` returns the raw stored JSON; diagnostics hashes it with the same function. Rename the field to `configJson` if you prefer; update the interface and test fake together.)

- [ ] **Step 4: Scopes**

Edit `shopify.app.toml`: `scopes = "read_products,write_discounts"`, delete the `[product.metafields.app.demo_info]` and `[metaobjects.app.example]` blocks, set `[webhooks] api_version = "2026-07"`. Run `shopify app config validate` (use the skill's `use-shopify-cli` reference). Also change `.graphqlrc.js`/code only if needed: they already use `July26`.

- [ ] **Step 5: Test, typecheck, commit**

Run: `npm test && npm run typecheck`: Expected PASS.
```bash
git add app/bundles shopify.app.toml tests && git commit -m "feat(sync): idempotent shared-discount sync with Admin gateway"
```

---

## Task 6: Admin navigation, dashboard and Bundles list

**Files:**
- Create: `app/routes/app.bundles._index.tsx`, `app/bundles/index.server.ts`
- Modify: `app/routes/app.jsx` (nav links), `app/routes/app._index.jsx` (dashboard; replace the template demo content)
- Test: `tests/bundlesListAction.test.ts`

**Interfaces:**
- Consumes: `bundleRepo`, `syncShop`, `adminDiscountGateway`.
- Produces: `app/bundles/actions.server.ts`:
```ts
export async function runBundleAction(deps: { shop: string; repo: BundleRepo; sync: () => Promise<{status:string;message?:string}> }, form: FormData): Promise<{ ok: boolean; message: string }>
// form: intent = activate|pause|archive|duplicate ; ids = repeated field (bulk). Unknown intent => ok:false.
```

- [ ] **Step 1: Failing test for actions (bulk + isolation)**

```ts
// tests/bundlesListAction.test.ts
import { beforeEach, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { runBundleAction } from "../app/bundles/actions.server";
import { createTestPrisma, resetTestDb } from "./testDb";

const A = "a.myshopify.com", B = "b.myshopify.com";
const input = (name: string) => ({ name, status: "draft" as const, pricingKind: "percentage" as const, pricingValue: 1000, items: [
  { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 1 }] });
let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => { const p = await createTestPrisma(); await resetTestDb(p); repo = createBundleRepo(p); });
const form = (o: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) [v].flat().forEach((x) => f.append(k, x)); return f; };

test("bulk activate then sync once", async () => {
  const a = await repo.create(A, "USD", input("A")); const b = await repo.create(A, "USD", input("B"));
  const sync = vi.fn(async () => ({ status: "created" }));
  const r = await runBundleAction({ shop: A, repo, sync }, form({ intent: "activate", ids: [a.id, b.id] }));
  expect(r.ok).toBe(true);
  expect(sync).toHaveBeenCalledTimes(1);
  expect((await repo.list(A)).every((x) => x.status === "active")).toBe(true);
});
test("cannot act on another shop's bundles", async () => {
  const other = await repo.create(B, "USD", input("Other"));
  const sync = vi.fn(async () => ({ status: "noop" }));
  await runBundleAction({ shop: A, repo, sync }, form({ intent: "archive", ids: [other.id] }));
  expect((await repo.get(B, other.id))!.status).toBe("draft");
});
test("duplicate and unknown intent", async () => {
  const a = await repo.create(A, "USD", input("A"));
  const sync = vi.fn(async () => ({ status: "noop" }));
  expect((await runBundleAction({ shop: A, repo, sync }, form({ intent: "duplicate", ids: [a.id] }))).ok).toBe(true);
  expect(await repo.list(A)).toHaveLength(2);
  expect((await runBundleAction({ shop: A, repo, sync }, form({ intent: "explode", ids: [a.id] }))).ok).toBe(false);
});
test("sync error is surfaced", async () => {
  const a = await repo.create(A, "USD", input("A"));
  const r = await runBundleAction({ shop: A, repo, sync: async () => ({ status: "error", message: "boom" }) }, form({ intent: "activate", ids: [a.id] }));
  expect(r.ok).toBe(false);
  expect(r.message).toContain("boom");
});
```
Run: Expected FAIL.

- [ ] **Step 2: Implement `actions.server.ts` and `index.server.ts`**

```ts
// app/bundles/actions.server.ts
import type { BundleRepo } from "./repo.server";
import type { BundleStatus } from "./types";

const STATUS: Record<string, BundleStatus> = { activate: "active", pause: "paused", archive: "archived" };

export async function runBundleAction(
  deps: { shop: string; repo: BundleRepo; sync: () => Promise<{ status: string; message?: string }> },
  form: FormData,
): Promise<{ ok: boolean; message: string }> {
  const intent = String(form.get("intent") ?? "");
  const ids = form.getAll("ids").map(String).slice(0, 100);
  if (ids.length === 0) return { ok: false, message: "Select at least one bundle." };
  if (intent === "duplicate") {
    for (const id of ids) await deps.repo.duplicate(deps.shop, id);
    return { ok: true, message: "Bundle duplicated as draft." };
  }
  const status = STATUS[intent];
  if (!status) return { ok: false, message: "Unknown action." };
  for (const id of ids) await deps.repo.setStatus(deps.shop, id, status);
  const r = await deps.sync();
  return r.status === "error" ? { ok: false, message: `Saved, but Shopify sync failed: ${r.message}` } : { ok: true, message: "Updated." };
}
```
```ts
// app/bundles/index.server.ts
import prisma from "../db.server";
import { createBundleRepo } from "./repo.server";
import { syncShop } from "./sync.server";
import { adminDiscountGateway } from "./shopifyDiscount.server";

export const bundleRepo = createBundleRepo(prisma);
export const syncForShop = (shop: string, admin: Parameters<typeof adminDiscountGateway>[0]) =>
  syncShop({ shop, prisma, repo: bundleRepo, gateway: adminDiscountGateway(admin) });
```
Run the test: Expected PASS.

- [ ] **Step 3: Route `app/routes/app.bundles._index.tsx`** (loader reads `status`, `q`, `sort`, `dir` from the URL; `shop` only from the session)

```tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, useSubmit, useActionData, Form, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { bundleRepo, syncForShop } from "../bundles/index.server";
import { runBundleAction } from "../bundles/actions.server";
import type { BundleStatus } from "../bundles/types";

const STATUSES = ["draft", "active", "paused", "archived"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = STATUSES.find((s) => s === url.searchParams.get("status"));
  const sort = url.searchParams.get("sort") === "name" ? "name" : "updatedAt";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const bundles = await bundleRepo.list(session.shop, { status: status as BundleStatus | undefined, search: url.searchParams.get("q") ?? undefined, sort, dir });
  return { bundles: bundles.map((b) => ({ id: b.id, name: b.name, status: b.status, pricingKind: b.pricingKind, pricingValue: b.pricingValue, currencyCode: b.currencyCode, items: b.items.length, syncStatus: b.syncStatus, syncError: b.syncError, updatedAt: b.updatedAt.toISOString() })) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  return runBundleAction({ shop: session.shop, repo: bundleRepo, sync: () => syncForShop(session.shop, admin) }, await request.formData());
};

const discountLabel = (b: { pricingKind: string; pricingValue: number; currencyCode: string }) =>
  b.pricingKind === "percentage" ? `${b.pricingValue / 100}% off` : `${(b.pricingValue / 100).toFixed(2)} ${b.currencyCode} off`;

export default function Bundles() {
  const { bundles } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [params, setParams] = useSearchParams();
  const submit = useSubmit();
  return (
    <s-page heading="Bundles">
      <s-button slot="primary-action" href="/app/bundles/new">Create bundle</s-button>
      {result && <s-banner tone={result.ok ? "success" : "critical"}>{result.message}</s-banner>}
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-search-field label="Search" labelAccessibilityVisibility="exclusive" value={params.get("q") ?? ""}
            onInput={(e: any) => { const n = new URLSearchParams(params); n.set("q", e.currentTarget.value); setParams(n, { replace: true }); }} />
          <s-select label="Status" labelAccessibilityVisibility="exclusive" value={params.get("status") ?? ""}
            onChange={(e: any) => { const n = new URLSearchParams(params); e.currentTarget.value ? n.set("status", e.currentTarget.value) : n.delete("status"); setParams(n); }}>
            <s-option value="">All statuses</s-option>
            {STATUSES.map((s) => <s-option key={s} value={s}>{s}</s-option>)}
          </s-select>
          <s-select label="Sort" labelAccessibilityVisibility="exclusive" value={`${params.get("sort") ?? "updatedAt"}:${params.get("dir") ?? "desc"}`}
            onChange={(e: any) => { const [s, d] = e.currentTarget.value.split(":"); const n = new URLSearchParams(params); n.set("sort", s); n.set("dir", d); setParams(n); }}>
            <s-option value="updatedAt:desc">Recently updated</s-option>
            <s-option value="name:asc">Name A–Z</s-option>
            <s-option value="name:desc">Name Z–A</s-option>
          </s-select>
        </s-stack>
      </s-section>
      {bundles.length === 0 ? (
        <s-section><s-stack gap="base"><s-heading>No bundles yet</s-heading><s-paragraph>Create a fixed bundle: pick products, set a discount, and show it on your product pages.</s-paragraph><s-button href="/app/bundles/new">Create bundle</s-button></s-stack></s-section>
      ) : (
        <Form method="post" onChange={() => undefined}>
          <s-section padding="none">
            <s-table>
              <s-table-header-row>
                <s-table-header>Select</s-table-header><s-table-header>Bundle</s-table-header><s-table-header>Type</s-table-header>
                <s-table-header>Products</s-table-header><s-table-header>Discount</s-table-header><s-table-header>Status</s-table-header><s-table-header>Updated</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {bundles.map((b) => (
                  <s-table-row key={b.id}>
                    <s-table-cell><input type="checkbox" name="ids" value={b.id} aria-label={`Select ${b.name}`} /></s-table-cell>
                    <s-table-cell><Link to={`/app/bundles/${b.id}`}>{b.name}</Link>{b.syncStatus === "error" && <s-badge tone="critical">Sync failed</s-badge>}</s-table-cell>
                    <s-table-cell>Fixed</s-table-cell>
                    <s-table-cell>{b.items} products</s-table-cell>
                    <s-table-cell>{discountLabel(b)}</s-table-cell>
                    <s-table-cell><s-badge tone={b.status === "active" ? "success" : "neutral"}>{b.status}</s-badge></s-table-cell>
                    <s-table-cell>{new Date(b.updatedAt).toLocaleDateString()}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
          <s-stack direction="inline" gap="base">
            {["activate", "pause", "archive", "duplicate"].map((i) => <button key={i} type="submit" name="intent" value={i}>{i[0].toUpperCase() + i.slice(1)} selected</button>)}
          </s-stack>
        </Form>
      )}
    </s-page>
  );
}
```
Validate the markup with `--api polaris-app-home`; the validator may require `s-button` instead of plain `button` or different table element names: follow its errors (the executor owns exact tag names, behaviour stays the same). Replace the checkbox/bulk bar with `s-checkbox`/`s-button type="submit"` if reported.

- [ ] **Step 4: Navigation and dashboard**

In `app/routes/app.jsx` replace the nav with:
```jsx
<s-app-nav>
  <s-link href="/app">Dashboard</s-link>
  <s-link href="/app/bundles">Bundles</s-link>
  <s-link href="/app/diagnostics">Diagnostics</s-link>
</s-app-nav>
```
(keep existing providers and the `Additional page` route untouched or remove its link only.) Replace the demo body in `app/routes/app._index.jsx` with a loader that returns `bundleRepo.countsByStatus(session.shop)` and the 5 most recent bundles, and renders: total/active/draft counts (`s-section` per metric), a primary "Create bundle" button, recent bundles list, quick links, empty state when total is 0, and a card labelled **"Performance"** that shows event counts from Task 9 once available and otherwise: "Bundle views and add-to-cart events appear here once your storefront block is live. Purchase and revenue tracking is not available." Do not render any number that is not read from the database. The template's demo "Generate a product" action must be removed.

- [ ] **Step 5: Run, typecheck, lint, commit**

Run: `npm test && npm run typecheck && npm run lint`: Expected PASS. Fix lint on new files only.
```bash
git add app tests && git commit -m "feat(admin): dashboard, bundles list with filters, bulk actions"
```

---

## Task 7: Create/edit bundle wizard with product picker

**Files:**
- Create: `app/bundles/shopifyCatalog.server.ts`, `app/routes/app.bundles.new.tsx`, `app/routes/app.bundles.$id.tsx`, `app/routes/app.products.search.tsx` (resource route returning JSON), `app/bundles/pricingPreview.ts`
- Test: `tests/catalog.test.ts`, `tests/pricingPreview.test.ts`, `tests/saveBundle.test.ts`
- Create: `app/bundles/save.server.ts`

**Interfaces:**
- Consumes: Tasks 4–6 exports; `allocate` etc. from Task 2.
- Produces:
```ts
// shopifyCatalog.server.ts
export interface CatalogVariant { id: string; title: string; priceMinor: number; sku: string | null; available: number | null; tracksInventory: boolean; imageUrl: string | null }
export interface CatalogProduct { id: string; title: string; imageUrl: string | null; status: string; variants: CatalogVariant[] }
export async function searchProducts(admin: Admin, term: string): Promise<CatalogProduct[]>
export async function fetchShopCurrency(admin: Admin): Promise<string>
export async function fetchVariantsByIds(admin: Admin, ids: string[]): Promise<Map<string, { id: string; productId: string; priceMinor: number }>>
// pricingPreview.ts
export function previewBundle(input: BundleInput, prices: Record<string, number>): { subtotalMinor: number; discountMinor: number; totalMinor: number }
// save.server.ts
export type SaveResult = { ok: true; bundleId: string; syncMessage?: string } | { ok: false; fieldErrors: Record<string, string>; message?: string }
export async function saveBundle(d: { shop: string; admin: Admin; repo: BundleRepo; sync: () => Promise<{status:string;message?:string}>; id?: string; expectedVersion?: number }, raw: unknown): Promise<SaveResult>
```

- [ ] **Step 1: Failing preview + save tests (the save path must re-fetch variants and reject unknown ones)**

```ts
// tests/pricingPreview.test.ts
import { expect, test } from "vitest";
import { previewBundle } from "../app/bundles/pricingPreview";
const items = [{ productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 2 }];
const base = { name: "n", status: "draft" as const, items };
const prices = { "gid://shopify/ProductVariant/1": 2000, "gid://shopify/ProductVariant/2": 1000 };
test("percentage preview uses the shared engine", () => {
  expect(previewBundle({ ...base, pricingKind: "percentage", pricingValue: 1000 }, prices)).toEqual({ subtotalMinor: 4000, discountMinor: 400, totalMinor: 3600 });
});
test("fixed preview clamps", () => {
  expect(previewBundle({ ...base, pricingKind: "fixed_amount_off", pricingValue: 99999 }, prices)).toEqual({ subtotalMinor: 4000, discountMinor: 4000, totalMinor: 0 });
});
```
```ts
// tests/saveBundle.test.ts
import { beforeEach, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { saveBundle } from "../app/bundles/save.server";
import { createTestPrisma, resetTestDb } from "./testDb";

const S = "a.myshopify.com";
const gid = (t: string, n: number) => `gid://shopify/${t}/${n}`;
const raw = (over: object = {}) => ({ name: "Duo", status: "draft", pricingKind: "percentage", pricingValue: 1000, items: [
  { productId: gid("Product", 1), variantId: gid("ProductVariant", 1), quantity: 1 }, { productId: gid("Product", 2), variantId: gid("ProductVariant", 2), quantity: 1 }], ...over });

const adminWith = (known: number[]) => ({ graphql: vi.fn(async (q: string) => ({ json: async () => q.includes("shop {") ? { data: { shop: { currencyCode: "USD" } } } : { data: { nodes: [1, 2, 3].map((n) => known.includes(n) ? { id: gid("ProductVariant", n), price: "10.00", product: { id: gid("Product", n) } } : null) } } }) })) as any;
let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => { const p = await createTestPrisma(); await resetTestDb(p); repo = createBundleRepo(p); });
const sync = async () => ({ status: "created" });

test("saves when every variant exists in Shopify", async () => {
  const r = await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw());
  expect(r.ok).toBe(true);
  expect(await repo.list(S)).toHaveLength(1);
});
test("rejects variants Shopify does not return (never trusts the form)", async () => {
  const r = await saveBundle({ shop: S, admin: adminWith([1]), repo, sync }, raw());
  expect(r.ok).toBe(false);
  expect((r as any).fieldErrors.items).toMatch(/not found/i);
  expect(await repo.list(S)).toHaveLength(0);
});
test("rejects product id that does not match the variant's product", async () => {
  const r = await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw({ items: [
    { productId: gid("Product", 9), variantId: gid("ProductVariant", 1), quantity: 1 }, { productId: gid("Product", 2), variantId: gid("ProductVariant", 2), quantity: 1 }] }));
  expect(r.ok).toBe(false);
});
test("validation errors come back per field", async () => {
  const r = await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw({ pricingValue: 0 }));
  expect(r.ok).toBe(false);
  expect((r as any).fieldErrors.pricingValue).toBeTruthy();
});
test("duplicate name returns a field error, not a crash", async () => {
  await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw());
  const r = await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw());
  expect((r as any).fieldErrors.name).toMatch(/already/i);
});
test("active save triggers sync; draft save does not", async () => {
  const s = vi.fn(sync);
  await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync: s }, raw());
  expect(s).not.toHaveBeenCalled();
  await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync: s }, raw({ name: "Duo 2", status: "active" }));
  expect(s).toHaveBeenCalledTimes(1);
});
test("stale version on edit reports a conflict", async () => {
  const a = (await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync }, raw())) as any;
  await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync, id: a.bundleId, expectedVersion: 1 }, raw({ name: "Duo v2" }));
  const r = await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync, id: a.bundleId, expectedVersion: 1 }, raw({ name: "Duo v3" }));
  expect((r as any).message).toMatch(/changed/i);
});
test("editing another shop's bundle id fails", async () => {
  const other = await repo.create("b.myshopify.com", "USD", { ...raw(), status: "draft" } as any);
  const r = await saveBundle({ shop: S, admin: adminWith([1, 2]), repo, sync, id: other.id, expectedVersion: 1 }, raw());
  expect(r.ok).toBe(false);
});
```
Run: Expected FAIL.

- [ ] **Step 2: Implement catalog, preview and save**

```ts
// app/bundles/pricingPreview.ts
import { allocate } from "../../extensions/bundle-discount/src/engine";
import type { BundleInput } from "./types";

export function previewBundle(input: BundleInput, prices: Record<string, number>) {
  const lines = input.items.map((i, n) => ({ id: `p${n}`, variantId: i.variantId, quantity: i.quantity, unitPriceMinor: prices[i.variantId] ?? 0 }));
  const subtotalMinor = lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
  const pricing = input.pricingKind === "percentage" ? { kind: "percentage", basisPoints: input.pricingValue } : { kind: "fixed_amount_off", amountMinor: input.pricingValue };
  const alloc = allocate([{ id: "preview", pricing, items: input.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })) }], lines);
  const discountMinor = alloc.reduce((s, a) => s + a.discountMinor, 0);
  return { subtotalMinor, discountMinor, totalMinor: subtotalMinor - discountMinor };
}
```
```ts
// app/bundles/shopifyCatalog.server.ts
import { currencyExponent, toMinor } from "../../extensions/bundle-discount/src/engine";

type Admin = { graphql: (q: string, o?: { variables?: unknown }) => Promise<Response> };
export interface CatalogVariant { id: string; title: string; priceMinor: number; sku: string | null; available: number | null; tracksInventory: boolean; imageUrl: string | null }
export interface CatalogProduct { id: string; title: string; imageUrl: string | null; status: string; variants: CatalogVariant[] }

const SEARCH = `#graphql
query SearchProductsForBundle($query: String, $first: Int!) {
  shop { currencyCode }
  products(first: $first, query: $query) {
    nodes {
      id title status featuredImage { url }
      variants(first: 50) { nodes { id title price sku inventoryQuantity inventoryItem { tracked } image { url } } }
    }
  }
}`;
const CURRENCY = `#graphql
query BundleShopCurrency { shop { currencyCode } }`;
const VARIANTS = `#graphql
query BundleVariantsByIds($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { id price product { id } } }
}`;

async function gql(admin: Admin, q: string, variables?: unknown) {
  const body = (await (await admin.graphql(q, { variables })).json()) as { data?: any; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

export async function searchProducts(admin: Admin, term: string): Promise<CatalogProduct[]> {
  const d = await gql(admin, SEARCH, { query: term.trim() ? `title:*${term.trim().replace(/[*:"\\]/g, "")}* AND status:active` : "status:active", first: 20 });
  const exp = currencyExponent(d.shop.currencyCode);
  return d.products.nodes.map((p: any) => ({
    id: p.id, title: p.title, status: p.status, imageUrl: p.featuredImage?.url ?? null,
    variants: p.variants.nodes.map((v: any) => ({ id: v.id, title: v.title, priceMinor: toMinor(v.price, exp), sku: v.sku, available: v.inventoryItem?.tracked ? v.inventoryQuantity : null, tracksInventory: !!v.inventoryItem?.tracked, imageUrl: v.image?.url ?? null })),
  }));
}
export async function fetchShopCurrency(admin: Admin): Promise<string> {
  return (await gql(admin, CURRENCY)).shop.currencyCode;
}
export async function fetchVariantsByIds(admin: Admin, ids: string[]) {
  const d = await gql(admin, VARIANTS, { ids });
  const exp = currencyExponent(await fetchShopCurrency(admin));
  const out = new Map<string, { id: string; productId: string; priceMinor: number }>();
  for (const n of d.nodes) if (n) out.set(n.id, { id: n.id, productId: n.product.id, priceMinor: toMinor(n.price, exp) });
  return out;
}
```
(The save test fake distinguishes the currency query by the substring `shop {`; keep `shop {` literally in `CURRENCY` as above.)

```ts
// app/bundles/save.server.ts
import { ZodError } from "zod";
import { fetchVariantsByIds, fetchShopCurrency } from "./shopifyCatalog.server";
import { parseBundleInput } from "./validation";
import type { BundleRepo } from "./repo.server";

type Admin = Parameters<typeof fetchShopCurrency>[0];
export type SaveResult = { ok: true; bundleId: string; syncMessage?: string } | { ok: false; fieldErrors: Record<string, string>; message?: string };

export async function saveBundle(
  d: { shop: string; admin: Admin; repo: BundleRepo; sync: () => Promise<{ status: string; message?: string }>; id?: string; expectedVersion?: number },
  raw: unknown,
): Promise<SaveResult> {
  let input;
  try { input = parseBundleInput(raw); }
  catch (e) {
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const i of e.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
      return { ok: false, fieldErrors };
    }
    throw e;
  }

  const found = await fetchVariantsByIds(d.admin, input.items.map((i) => i.variantId));
  const bad = input.items.filter((i) => found.get(i.variantId)?.productId !== i.productId);
  if (bad.length) return { ok: false, fieldErrors: { items: "One or more selected variants were not found in your store." } };

  try {
    let bundleId: string;
    if (d.id) {
      const r = await d.repo.update(d.shop, d.id, d.expectedVersion ?? 0, input);
      if (r === null) return { ok: false, fieldErrors: {}, message: "Bundle not found." };
      if (r === "conflict") return { ok: false, fieldErrors: {}, message: "This bundle changed in another tab. Reload and try again." };
      bundleId = r.id;
    } else {
      bundleId = (await d.repo.create(d.shop, await fetchShopCurrency(d.admin), input)).id;
    }
    if (input.status !== "draft" || d.id) {
      const s = await d.sync();
      if (s.status === "error") return { ok: true, bundleId, syncMessage: s.message };
    }
    return { ok: true, bundleId };
  } catch (e: any) {
    if (e?.code === "P2002") return { ok: false, fieldErrors: { name: "A bundle with this name already exists." } };
    throw e;
  }
}
```
Run all three test files: Expected PASS (fix test fake details, not behaviour, if the fake's shape needs adjusting).

- [ ] **Step 3: Routes**

`app.products.search.tsx` (resource route): loader → `authenticate.admin`, `searchProducts(admin, url.searchParams.get("q") ?? "")`, return `Response.json`.
`app.bundles.new.tsx` and `app.bundles.$id.tsx` share one `BundleForm` component in `app/bundles/BundleForm.tsx` (created in this step): sections **1 General** (name `s-text-field`, description `s-text-area`, status `s-select`), **2 Products** (search field calls `fetcher.load("/app/products/search?q=…")`, results show image/title/variant price/availability, "Add variant" per variant, selected list with quantity `s-number-field` and remove; cannot add the same variant twice; warns on out-of-stock; inline error when fewer than 2 variants), **3 Discount** (`s-select` percentage/fixed, `s-number-field`; percentage typed as percent and converted ×100 to basis points; fixed typed in shop currency and converted with `toMinor`), **4 Preview/Review** (live `previewBundle` of the selected variants, original price, discounted total, savings). The form submits JSON via `fetcher.submit(..., { method: "post", encType: "application/json" })` to the route action; the action calls `saveBundle({ shop: session.shop, admin, repo: bundleRepo, sync: () => syncForShop(...), id: params.id, expectedVersion }, await request.json())` and either `redirect("/app/bundles")` or returns the `SaveResult` for inline errors. The `$id` loader calls `bundleRepo.get(session.shop, params.id)` and throws `new Response("Not found", { status: 404 })` when null (this covers cross-shop ids). Show `syncError` in a critical banner with a "Retry sync" button that posts `intent=resync` handled in the action via `syncForShop`. When any selected variant is already in another active bundle (`bundleRepo.variantsInUse`), show a warning: "These products are in another active bundle; each unit is discounted by only one bundle (the highest saving applies)."

Validate the markup with `--api polaris-app-home`.

- [ ] **Step 4: Typecheck, run tests, manual smoke in dev store** (owner): create a draft bundle, then an active one; confirm a discount named "MobiBundler bundles" appears under Discounts. Record in Task 11.

- [ ] **Step 5: Commit**

```bash
git add app tests && git commit -m "feat(admin): create/edit wizard, product picker, server-side variant verification"
```

---

## Task 8: Webhooks and compliance

**Files:**
- Create: `app/routes/webhooks.products.update.tsx`, `app/routes/webhooks.products.delete.tsx`, `app/routes/webhooks.compliance.tsx`, `app/bundles/webhookHandlers.server.ts`, `app/bundles/variantHealth.server.ts`
- Modify: `app/routes/webhooks.app.uninstalled.jsx` (additive purge), `shopify.app.toml`
- Test: `tests/webhookHandlers.test.ts`

**Interfaces:**
- Consumes: `BundleRepo`, Task 5 sync.
- Produces: `handleShopErase(deps:{shop:string;repo:BundleRepo}): Promise<void>`; `findBrokenBundles(shop, prisma, removedVariantIds?)` described below; DB column reuse: broken variants are computed on demand, not stored.

- [ ] **Step 1: Failing handler tests**

```ts
// tests/webhookHandlers.test.ts
import { beforeEach, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { handleShopErase, handleProductDeleted } from "../app/bundles/webhookHandlers.server";
import { createTestPrisma, resetTestDb } from "./testDb";

const input = (name: string) => ({ name, status: "active" as const, pricingKind: "percentage" as const, pricingValue: 1000, items: [
  { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 1 }] });
let prisma: Awaited<ReturnType<typeof createTestPrisma>>, repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => { prisma = await createTestPrisma(); await resetTestDb(prisma); repo = createBundleRepo(prisma); });

test("shop erase removes only that shop's data and is replay-safe", async () => {
  await repo.create("a.myshopify.com", "USD", input("A")); await repo.create("b.myshopify.com", "USD", input("B"));
  await handleShopErase({ shop: "a.myshopify.com", repo });
  await handleShopErase({ shop: "a.myshopify.com", repo });
  expect(await repo.list("a.myshopify.com")).toEqual([]);
  expect(await repo.list("b.myshopify.com")).toHaveLength(1);
});
test("deleted product pauses affected active bundles of that shop only", async () => {
  const a = await repo.create("a.myshopify.com", "USD", input("A")); const b = await repo.create("b.myshopify.com", "USD", input("B"));
  const res = await handleProductDeleted({ shop: "a.myshopify.com", productId: "gid://shopify/Product/1", prisma, repo });
  expect(res.affected).toBe(1);
  expect((await repo.get("a.myshopify.com", a.id))!.status).toBe("paused");
  expect((await repo.get("a.myshopify.com", a.id))!.syncError).toMatch(/deleted/i);
  expect((await repo.get("b.myshopify.com", b.id))!.status).toBe("active");
  expect((await handleProductDeleted({ shop: "a.myshopify.com", productId: "gid://shopify/Product/1", prisma, repo })).affected).toBe(0);
});
```
Run: Expected FAIL.

- [ ] **Step 2: Implement**

```ts
// app/bundles/webhookHandlers.server.ts
import type { PrismaClient } from "@prisma/client";
import type { BundleRepo } from "./repo.server";

export async function handleShopErase(d: { shop: string; repo: BundleRepo }) {
  await d.repo.deleteAllForShop(d.shop);
}

/** A deleted product breaks its bundles: pause them (never delete) and say why. Idempotent. */
export async function handleProductDeleted(d: { shop: string; productId: string; prisma: PrismaClient; repo: BundleRepo }) {
  const items = await d.prisma.bundleItem.findMany({ where: { shop: d.shop, productId: d.productId, bundle: { status: "active" } }, select: { bundleId: true } });
  const ids = [...new Set(items.map((i) => i.bundleId))];
  if (ids.length === 0) return { affected: 0 };
  await d.prisma.bundle.updateMany({ where: { shop: d.shop, id: { in: ids } }, data: { status: "paused", syncStatus: "pending", syncError: "A product in this bundle was deleted from your store. Replace it, then reactivate." } });
  return { affected: ids.length };
}
```
Note: `handleProductDeleted` uses `prisma.bundleItem`/`prisma.bundle` outside `repo.server.ts`, which violates the Global Constraint; move this function into `repo.server.ts` as `pauseForDeletedProduct(shop, productId): Promise<number>` and make `handleProductDeleted` call it (update the interface line and the test to inject only `repo`). `noDirectPrisma.test.ts` must stay green.

Routes (each: `const { shop, topic, payload } = await authenticate.webhook(request);` then handler, then `return new Response()`; 200 always after verification):
- `webhooks.products.delete.tsx`: `handleProductDeleted({ shop, productId: \`gid://shopify/Product/${payload.id}\` , repo })`, then `syncForShop` via `unauthenticated.admin(shop)`; if no session/offline token exists skip sync.
- `webhooks.products.update.tsx`: acknowledge; v1 only logs `{shop, topic}` (variant removal detection happens in Diagnostics via live `fetchVariantsByIds`). Keep as a documented no-op hook so the subscription and tests exist; drop the subscription if you prefer not to carry a no-op route (preferred: **remove this route and its subscription** unless Diagnostics needs it).
- `webhooks.compliance.tsx`: switch on `topic`: `CUSTOMERS_DATA_REQUEST` and `CUSTOMERS_REDACT` → no customer data is stored, return 200; `SHOP_REDACT` → `handleShopErase` + delete sessions `db.session.deleteMany({ where: { shop } })`.
- `webhooks.app.uninstalled.jsx`: after the existing session delete add `await bundleRepo.deleteAllForShop(shop)` (import from `../bundles/index.server`), keeping the existing replay-safety comment.

`shopify.app.toml` webhooks:
```toml
[webhooks]
api_version = "2026-07"

  [[webhooks.subscriptions]]
  topics = [ "app/uninstalled" ]
  uri = "/webhooks/app/uninstalled"

  [[webhooks.subscriptions]]
  topics = [ "app/scopes_update" ]
  uri = "/webhooks/app/scopes_update"

  [[webhooks.subscriptions]]
  topics = [ "products/delete" ]
  uri = "/webhooks/products/delete"

  [[webhooks.subscriptions]]
  compliance_topics = [ "customers/data_request", "customers/redact", "shop/redact" ]
  uri = "/webhooks/compliance"
```
Validate with `shopify app config validate`.

- [ ] **Step 3: Run tests, typecheck, commit**

Run: `npm test && npm run typecheck`: PASS.
```bash
git add app shopify.app.toml tests && git commit -m "feat(webhooks): product delete handling, compliance topics, uninstall purge"
```

---

## Task 9: App proxy, storefront block and event tracking

**Files:**
- Create: `app/routes/app_proxy.bundles.tsx`, `app/routes/app_proxy.events.tsx`, `app/bundles/publicBundles.server.ts`, `app/bundles/events.server.ts`, `extensions/bundler-storefront/blocks/bundle.liquid`, `extensions/bundler-storefront/assets/bundle.js`, `extensions/bundler-storefront/assets/bundle.css`
- Delete: `extensions/bundler-storefront/blocks/star_rating.liquid`, `snippets/stars.liquid`, `assets/thumbs-up.png`
- Modify: `shopify.app.toml` (`[app_proxy]`), `extensions/bundler-storefront/locales/en.default.json`
- Test: `tests/events.test.ts`, `tests/publicBundles.test.ts`

**Interfaces:**
- Consumes: `BundleRepo`, `previewBundle`, `searchProducts`-style variant fetch via `unauthenticated.admin(shop)`.
- Produces:
```ts
// events.server.ts
export type EventType = "view" | "add_to_cart";
export function createEvents(prisma: PrismaClient, repo: BundleRepo): {
  record(shop: string, e: { bundleId: string; type: EventType; dedupeKey: string }): Promise<"recorded" | "duplicate" | "ignored">;
  counts(shop: string, sinceDays: number): Promise<{ view: number; add_to_cart: number }>;
}
// publicBundles.server.ts
export interface PublicBundle { id: string; name: string; items: { variantNumericId: string; title: string; quantity: number; imageUrl: string | null; priceMinor: number }[]; subtotalMinor: number; discountMinor: number; totalMinor: number; currencyCode: string }
export async function getPublicBundles(d: { shop: string; ids: string[]; repo: BundleRepo; admin: Admin }): Promise<PublicBundle[]>   // only status=active, only this shop
```
`BundleEvent` queries live in `events.server.ts`; add the event methods to `repo.server.ts` instead (`recordEvent`, `eventCounts`) so the no-direct-prisma rule holds, and have `events.server.ts` wrap the repo.

- [ ] **Step 1: Failing tests**

```ts
// tests/events.test.ts
import { beforeEach, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createEvents } from "../app/bundles/events.server";
import { createTestPrisma, resetTestDb } from "./testDb";

const input = { name: "A", status: "active" as const, pricingKind: "percentage" as const, pricingValue: 1000, items: [
  { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 1 }] };
let repo: ReturnType<typeof createBundleRepo>, ev: ReturnType<typeof createEvents>;
beforeEach(async () => { const p = await createTestPrisma(); await resetTestDb(p); repo = createBundleRepo(p); ev = createEvents(repo); });

test("records once per dedupe key, ignores unknown bundle and other shop's bundle", async () => {
  const b = await repo.create("a.myshopify.com", "USD", input);
  expect(await ev.record("a.myshopify.com", { bundleId: b.id, type: "view", dedupeKey: "k1" })).toBe("recorded");
  expect(await ev.record("a.myshopify.com", { bundleId: b.id, type: "view", dedupeKey: "k1" })).toBe("duplicate");
  expect(await ev.record("a.myshopify.com", { bundleId: "nope", type: "view", dedupeKey: "k2" })).toBe("ignored");
  expect(await ev.record("b.myshopify.com", { bundleId: b.id, type: "view", dedupeKey: "k3" })).toBe("ignored");
  expect(await ev.counts("a.myshopify.com", 30)).toEqual({ view: 1, add_to_cart: 0 });
});
test("rejects oversized or malformed keys", async () => {
  const b = await repo.create("a.myshopify.com", "USD", input);
  expect(await ev.record("a.myshopify.com", { bundleId: b.id, type: "view", dedupeKey: "x".repeat(200) })).toBe("ignored");
  expect(await ev.record("a.myshopify.com", { bundleId: b.id, type: "purchase" as any, dedupeKey: "k" })).toBe("ignored");
});
```
(Update the `createEvents` signature in Interfaces to `createEvents(repo: BundleRepo)`.) Also write `tests/publicBundles.test.ts`: only active bundles of the shop are returned; draft/archived/other-shop ids are omitted; `variantNumericId` is the trailing digits of the gid; totals match `previewBundle`. Run: Expected FAIL.

- [ ] **Step 2: Implement events + public bundles** (repo gets `recordEvent(shop, bundleId, type, dedupeKey): Promise<"recorded"|"duplicate"|"ignored">` using a `findFirst({id, shop})` ownership check then `create` catching `P2002`, and `eventCounts(shop, sinceDays)` using `groupBy`). `createEvents(repo)` validates `type ∈ {view, add_to_cart}` and `dedupeKey` matches `/^[A-Za-z0-9_-]{1,64}$/` before calling the repo. `getPublicBundles` loads `repo.get(shop, id)` for each requested id (max 10), keeps `status === "active"`, fetches variant titles/images/prices with the Admin client (`nodes(ids:)` query extended with `title image { url } product { title }`), and computes totals with `previewBundle`.

- [ ] **Step 3: Proxy routes**

```ts
// app/routes/app_proxy.bundles.tsx
import type { LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { bundleRepo } from "../bundles/index.server";
import { getPublicBundles } from "../bundles/publicBundles.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request); // verifies Shopify's signature; rejects otherwise
  if (!session) return Response.json({ bundles: [] }, { status: 200 });
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 10);
  const { admin } = await unauthenticated.admin(session.shop);
  const bundles = await getPublicBundles({ shop: session.shop, ids, repo: bundleRepo, admin });
  return Response.json({ bundles }, { headers: { "Cache-Control": "public, max-age=30" } });
};
```
`app_proxy.events.tsx`: `action` only; `authenticate.public.appProxy(request)`; parse JSON `{bundleId,type,dedupeKey}`; `createEvents(bundleRepo).record(session.shop, …)`; always return `204`. Rate limit: in-memory sliding window per `${shop}:${ip}` (60 req/min, `app/bundles/rateLimit.server.ts`, with a unit test `tests/rateLimit.test.ts`); note in the file that multi-instance deployments need a shared store.

`shopify.app.toml` add: `[app_proxy]` with `url = "/app_proxy"`, `prefix = "apps"`, `subpath = "mobi-bundler"`. If `shopify app config validate` or deploy requires `write_app_proxy`, add it to `scopes` and record it (Task 0 evidence).

- [ ] **Step 4: Theme block** (replace scaffold; validate with `--api liquid --context app`)

`blocks/bundle.liquid`:
```liquid
{% comment %} MobiBundler bundle block. Prices shown are informational; the discount is applied at checkout. {% endcomment %}
{{ 'bundle.css' | asset_url | stylesheet_tag }}
<div class="mobi-bundle" data-bundle-id="{{ block.settings.bundle_id | escape }}" data-proxy="/apps/mobi-bundler" data-money-format="{{ shop.money_format | escape }}" {{ block.shopify_attributes }}>
  <p class="mobi-bundle__loading">{{ 'bundle.loading' | t }}</p>
</div>
<script src="{{ 'bundle.js' | asset_url }}" defer></script>
{% schema %}
{
  "name": "Bundle",
  "target": "section",
  "stylesheet": "bundle.css",
  "settings": [
    { "type": "text", "id": "bundle_id", "label": "Bundle ID", "info": "Copy the ID from the bundle page in the MobiBundler app." },
    { "type": "color", "id": "accent", "label": "Accent color", "default": "#111111" }
  ]
}
{% endschema %}
```
`assets/bundle.js`: for each `.mobi-bundle`, `fetch(`${proxy}/bundles?ids=${id}`)`, render items (image, title, quantity), original total (strikethrough), discounted total and savings using `Intl.NumberFormat` with `Shopify.currency.active` fallback to the bundle's `currencyCode`, and an "Add bundle to cart" button that POSTs `{ items: [{ id: variantNumericId, quantity, properties: { _mobi_bundle: bundleId } }] }` to `/cart/add.js`, then fires `fetch(`${proxy}/events`, { method:'POST', body: JSON.stringify({ bundleId, type:'add_to_cart', dedupeKey: crypto.randomUUID() }) })` and refreshes the cart UI by redirecting to `/cart`. Fire a `view` event once per page load per bundle (`dedupeKey = sessionStorage` stable key `view-${bundleId}-${Date.now()/3600000|0}`). Never send a price. Handle `422` from `/cart/add.js` (sold out) by showing `bundle.sold_out`. Add the three `bundle.*` strings to `locales/en.default.json`. Keep the scaffold's `uid` in `shopify.extension.toml`.

- [ ] **Step 5: Run tests, typecheck, build, commit**

Run: `npm test && npm run typecheck && npm run build`: PASS.
```bash
git add -A && git commit -m "feat(storefront): app proxy, bundle theme block, event tracking"
```

---

## Task 10: Diagnostics page, dashboard performance card, Postgres deploy docs

**Files:**
- Create: `app/routes/app.diagnostics.tsx`, `app/bundles/diagnostics.server.ts`, `docs/deployment.md`
- Test: `tests/diagnostics.test.ts`
- Modify: `app/routes/app._index.jsx` (performance card wired to `events.counts`)

**Interfaces:**
- Produces:
```ts
export interface DiagnosticItem { level: "ok" | "warning" | "critical"; code: string; message: string }
export async function runDiagnostics(d: { shop: string; repo: BundleRepo; prisma: PrismaClient; gateway: DiscountGateway; fetchVariants: (ids: string[]) => Promise<Map<string, unknown>> }): Promise<DiagnosticItem[]>
```
Checks: shared discount exists and is `ACTIVE` when bundles are active (`critical` `DISCOUNT_MISSING`/`DISCOUNT_INACTIVE` with "Re-sync" action); stored metafield equals the current config hash (`CONFIG_DRIFT`, warning); any bundle `syncStatus=error` (`SYNC_ERROR`); any active bundle component variant missing in Shopify (`VARIANT_MISSING`, names the bundle); overlap warning (variant in >1 active bundle, `OVERLAP`); config budget usage over 80% (`CONFIG_BUDGET`); granted scopes missing `write_discounts` (`SCOPE_MISSING`, passed as an input). 

- [ ] **Step 1: Write failing tests** covering each code with fakes (gateway `inspect` returning null/INACTIVE/mismatching JSON, `fetchVariants` omitting an id, two active bundles sharing a variant, 60 KB config) and one asserting a clean shop returns `[{ level: "ok", code: "ALL_OK", … }]`. Run: Expected FAIL.

- [ ] **Step 2: Implement `diagnostics.server.ts`** to satisfy the tests, hashing the inspected raw JSON with the same SHA-256 as `serializeSharedConfig` (export a `hashConfigJson(json: string)` from `config.ts` and use it in both places; update `sync.server.ts` import).

- [ ] **Step 3: Route** `app.diagnostics.tsx`: loader builds the deps from the session (`unauthenticated`/`authenticate.admin`), renders each item in an `s-banner` by level, and a "Re-sync now" form posting `intent=resync` to its action (`syncForShop`). No customer data.

- [ ] **Step 4: Dashboard performance card**: show `events.counts(shop, 30)` as "Views (30 days)" and "Add to cart (30 days)" with the unavailable-purchases notice; show "No data yet" when both are 0.

- [ ] **Step 5: Write `docs/deployment.md`** with: (1) distribution decision and its immutability, public vs custom table; (2) PostgreSQL: `node scripts/gen-postgres-schema.mjs`; first-time baseline `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/postgres/schema.prisma --script > prisma/postgres/migrations/0001_baseline/migration.sql` then `DATABASE_URL=… npx prisma migrate deploy --schema prisma/postgres/schema.prisma`; update the `Dockerfile`/`docker-start` to use the Postgres schema in production **only after the owner approves**; (3) env vars (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`, `DATABASE_URL`); (4) a note that nothing was deployed by the agent and that the owner runs `shopify app deploy` themselves; (5) future purchase attribution requirements (not implemented): `orders/paid`, `read_orders` (last 60 days, `read_all_orders` needs approval), protected customer data review, to be re-verified at that time.

- [ ] **Step 6: Run, commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`: PASS.
```bash
git add -A && git commit -m "feat(admin): diagnostics, performance card, deployment docs"
```

---

## Task 11: Final verification and dev-store checklist

**Files:**
- Create: `docs/manual-test-checklist.md`
- Modify: spec section 3/8 (final statuses)

- [ ] **Step 1: Full automated gate**

Run, in order, and paste results into the report:
```bash
npm test
npm run typecheck
npm run lint
npm run build
cd extensions/bundle-discount && npm exec shopify app function build && cd ../..
shopify app config validate
sqlite3 prisma/dev.sqlite "select count(*) from Session;"   # must equal the pre-migration backup count
git status --short | head -50
```
Expected: all pass; Session count unchanged. Do **not** run `shopify app deploy`.

- [ ] **Step 2: Write `docs/manual-test-checklist.md`** from spec section 7 as checkboxes with columns Expected / Result / Notes, grouped: prerequisites (distribution public, dev store, theme OS 2.0), admin (create/edit/duplicate/pause/archive/bulk), discount (one shared discount; apply; extra units; set counts; overlap; same product on two lines; quantity edits), stacking (native %, free shipping, other app's product discount), currencies/Markets, proxy/events (bad signature, dedupe), uninstall and `shop/redact`, non-Plus behaviour for each distribution type, and the S1/S2/S3 results.

- [ ] **Step 3: Report to the owner** with: what passed (commands + output), what was **not** verified (everything in the manual checklist), spike statuses, risks from spec section 8, and an explicit statement that purchase/revenue/conversion analytics are not implemented or claimed. Then ask for approval before any commit/PR/deploy.

- [ ] **Step 4: Commit docs**

```bash
git add docs && git commit -m "docs: manual dev-store checklist and final spec statuses"
```

---

## Self-Review (spec ↔ plan)

- **S1 capacity / shared discount:** Task 0 (live confirm) + Task 5 (single discount, `ShopDiscount`, 1 slot) + Task 4 (64 KB/10-component budgets). ✔
- **S2 `$app`:** Task 0 Step 4, `CONFIG_NAMESPACE` constant (Task 4), gateway (Task 5), Function query (Task 0 Step 2). ✔
- **S3 stacking:** engine overlap/duplicate/multi-bundle/quantity tests (Task 2), adapter tests (Task 3), combinesWith defaults (Task 5), manual S3 (Tasks 0, 11). ✔
- **S4 distribution:** Global Constraints, Task 0 Step 1, compliance webhooks (Task 8), `docs/deployment.md` (Task 10). ✔
- **Order tracking out of v1:** no `read_orders`/`orders/paid`; dashboard says not tracked (Tasks 6, 10); future requirements documented (Task 10). ✔
- **Database:** portable schema, additive migration, backup, Postgres generator + parity test, docs (Tasks 1, 10). ✔
- **V1 flow:** create (7) → save (4/7) → sync (5) → render (9) → add to cart (9) → discount (3). Fixed price excluded; `BundleStrategy` + `pricing.kind` dispatch + unknown-kind skip. ✔
- **Auth/isolation/idempotency/webhook verification:** repo tests (4), action tests (6), save tests (7), webhook tests (8), proxy signature (9), `noDirectPrisma` (4). ✔
- **Type consistency:** `BundleRepo` method names used in Tasks 5–10 match Task 4 (`recordEvent`/`eventCounts`/`pauseForDeletedProduct` are added to the repo in Tasks 8–9 and their Interfaces blocks say so). `DiscountGateway.inspect` returns `configHash` holding raw JSON (hash it with `hashConfigJson`); the Task 10 diagnostics do exactly that.
- **Known gaps stated, not hidden:** exact Polaris tag names and GraphQL fields are validated at execution with the skill validators; `$app` write behaviour, stacking against other apps, and the instruction budget are measured, not assumed.
