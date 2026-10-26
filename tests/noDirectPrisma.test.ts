import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

test("only repo.server.ts touches bundle tables", () => {
  const offenders = walk("app").filter((f) => {
    if (!/\.(ts|tsx|js|jsx)$/.test(f) || f.endsWith("repo.server.ts")) return false;
    const src = readFileSync(f, "utf8");
    return /\.(bundle|bundleItem|bundleEvent|orderRecord|bundleOrderRevenue|revenueSyncState)\s*\./.test(src) && /prisma|db\./.test(src);
  });
  expect(offenders).toEqual([]);
});
