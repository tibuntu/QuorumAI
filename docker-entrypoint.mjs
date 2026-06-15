// Container entrypoint for the distroless runtime image.
//
// The runner is gcr.io/distroless/nodejs* — there is no /bin/sh, so the
// previous `sh -c "prisma migrate deploy && node server.js"` CMD cannot work.
// This launcher reproduces that sequence purely in Node: apply pending
// migrations, then hand off to the Next.js standalone server.
//
// The Prisma CLI lives in its own self-contained directory (/app/_prisma) — a
// minimal install kept separate from the standalone node_modules. Running it
// with that directory as cwd lets prisma.config.ts resolve `prisma/config` and
// `dotenv/config` locally, and lets it auto-discover the schema + migrations.
import { spawnSync } from "node:child_process";

const PRISMA_DIR = "/app/_prisma";

const migrate = spawnSync(
  process.execPath,
  [`${PRISMA_DIR}/node_modules/prisma/build/index.js`, "migrate", "deploy"],
  { cwd: PRISMA_DIR, stdio: "inherit" },
);

if (migrate.status !== 0) {
  console.error(
    `prisma migrate deploy failed (exit ${migrate.status ?? "signal " + migrate.signal})`,
  );
  process.exit(migrate.status ?? 1);
}

// server.js is the Next standalone entry; importing it boots the HTTP server.
await import("./server.js");
