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
