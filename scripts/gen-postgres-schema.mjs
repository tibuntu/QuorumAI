#!/usr/bin/env node
// Generates prisma/schema.postgres.prisma from the canonical prisma/schema.prisma
// by swapping ONLY the datasource provider (sqlite -> postgresql). The Postgres
// schema is otherwise identical, so the SQLite schema stays the single source of
// truth and the two can never drift.
//
//   node scripts/gen-postgres-schema.mjs            # (re)generate the file
//   node scripts/gen-postgres-schema.mjs --check     # CI: exit 1 if the file is stale
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "prisma", "schema.prisma");
const OUT = join(root, "prisma", "schema.postgres.prisma");

const HEADER =
  "// AUTO-GENERATED from prisma/schema.prisma — DO NOT EDIT.\n" +
  "// Regenerate with: node scripts/gen-postgres-schema.mjs\n\n";

function render() {
  const src = readFileSync(SRC, "utf8");
  if (!src.includes('provider = "sqlite"')) {
    throw new Error('gen-postgres-schema: expected `provider = "sqlite"` in prisma/schema.prisma');
  }
  return HEADER + src.replace('provider = "sqlite"', 'provider = "postgresql"');
}

const want = render();

if (process.argv.includes("--check")) {
  let have = null;
  try {
    have = readFileSync(OUT, "utf8");
  } catch {
    /* missing → stale */
  }
  if (have !== want) {
    console.error("prisma/schema.postgres.prisma is stale — run: node scripts/gen-postgres-schema.mjs");
    process.exit(1);
  }
  console.log("prisma/schema.postgres.prisma is up to date");
} else {
  writeFileSync(OUT, want);
  console.log("wrote prisma/schema.postgres.prisma");
}
