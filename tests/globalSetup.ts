// Creates an isolated sqlite DB from the real migrations; never touches prisma/dev.sqlite.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

export default function setup() {
  const dir = path.resolve("prisma/.tmp-test");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const dbUrl = `file:${path.join(dir, "test.sqlite")}`;
  const schema = readFileSync("prisma/schema.prisma", "utf8").replace(
    /url\s*=\s*"file:[^"]*"/,
    `url = "${dbUrl}"`,
  );
  writeFileSync(path.join(dir, "schema.prisma"), schema);
  cpSync("prisma/migrations", path.join(dir, "migrations"), { recursive: true });
  execFileSync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", path.join(dir, "schema.prisma")],
    { stdio: "inherit" },
  );
  process.env.TEST_DATABASE_URL = dbUrl;
}
