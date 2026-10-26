// Generates prisma/postgres/schema.prisma from prisma/schema.prisma (only the datasource differs).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("prisma/schema.prisma", "utf8");
const out = src
  .replace('provider = "sqlite"', 'provider = "postgresql"')
  .replace(/url\s*=\s*"file:[^"]*"/, 'url      = env("DATABASE_URL")');
mkdirSync("prisma/postgres", { recursive: true });
writeFileSync("prisma/postgres/schema.prisma", out);
