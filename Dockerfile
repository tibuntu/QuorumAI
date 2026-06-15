# syntax=docker/dockerfile:1
# NOTE: The exact prisma-CLI-in-runner path (node node_modules/prisma/build/index.js)
# and better-sqlite3 native module availability are validated by the CI docker job.
# The generated Prisma client lives at /app/generated/prisma (per schema output setting).

FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

# Full dependency tree (incl. devDependencies) — needed to build Next and to
# generate the Prisma client. None of this tree is shipped to the runtime image.
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# prisma schema + config are needed because the `postinstall` lifecycle runs `prisma generate`
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN pnpm install --frozen-lockfile

FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1
RUN pnpm dlx prisma generate
RUN pnpm build

# Stage a PATCHED OpenSSL 3 (Debian's current libssl3) for the distroless
# runtime. Distroless ships an older libssl3 that trivy flags (the lib Prisma's
# schema engine links against); we overlay both the .so files and the dpkg
# status.d metadata so the runtime uses — and scanners report — the fixed
# version. /patched mirrors the target paths and is copied into the runner as-is.
RUN set -eu; \
    apt-get update && apt-get install -y --no-install-recommends libssl3; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) dir=x86_64-linux-gnu;; arm64) dir=aarch64-linux-gnu;; *) echo "unsupported arch $arch" >&2; exit 1;; esac; \
    mkdir -p "/patched/usr/lib/$dir" /patched/var/lib/dpkg/status.d; \
    cp "/usr/lib/$dir/libssl.so.3" "/usr/lib/$dir/libcrypto.so.3" "/patched/usr/lib/$dir/"; \
    dpkg-query -s libssl3 > /patched/var/lib/dpkg/status.d/libssl3; \
    cp "/var/lib/dpkg/info/libssl3:$arch.md5sums" /patched/var/lib/dpkg/status.d/libssl3.md5sums; \
    rm -rf /var/lib/apt/lists/*

# Minimal Prisma CLI for `migrate deploy` on startup. Installed with npm so the
# tree is flat and symlink-free (COPYs cleanly into distroless). The Prisma 7
# CLI eagerly requires its bundled subsystems (Studio, the pglite dev DB) even
# for `migrate deploy`, so those are left intact. Only the leaf SQL drivers for
# other engines — mysql2 and postgres — are dropped: this app is SQLite, and
# they are lazy-loaded, never reached by a SQLite deploy. This tree is kept in
# its own directory at runtime, so it cannot collide with the standalone
# node_modules.
FROM base AS migrator
WORKDIR /migrator
COPY docker/migrator/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock \
 && rm -rf node_modules/mysql2 node_modules/postgres

# Distroless runtime: no shell and no package manager, so the dev-dependency
# attack surface (and the lodash CVE) is gone and there is nothing extra for a
# scanner to flag. The app runs entirely from the Next standalone bundle; only a
# minimal Prisma CLI is added on top for migrations.
FROM gcr.io/distroless/nodejs24-debian12 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/app.db"
ENV PORT=3000
# Next standalone server.js binds to $HOSTNAME, which Docker auto-sets to the
# container ID — leaving the server off loopback so the HEALTHCHECK's
# 127.0.0.1 probe is refused. Bind to all interfaces (Next's documented config).
ENV HOSTNAME="0.0.0.0"

# Vendor the patched OpenSSL 3 staged in the builder over distroless's older
# libssl3 (both the .so files Prisma's schema engine links against and the dpkg
# status.d metadata trivy reads). /patched mirrors the target FS layout.
COPY --from=builder /patched/ /

# App runtime: the Next standalone output is self-contained — server.js plus a
# trimmed, traced node_modules (incl. @prisma/client, the better-sqlite3 adapter
# and its native binary). No full node_modules overlay.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/generated ./generated

# Isolated Prisma CLI used only for `migrate deploy` on start. Kept entirely
# under /app/_prisma (its own node_modules + schema + config) so nothing here
# touches the standalone node_modules. docker-entrypoint.mjs runs prisma with
# this directory as cwd, so prisma.config.ts resolves `prisma/config` /
# `dotenv/config` locally and auto-discovers prisma/schema.prisma + migrations.
COPY --from=migrator /migrator/node_modules ./_prisma/node_modules
COPY --from=builder /app/prisma ./_prisma/prisma
COPY --from=builder /app/prisma.config.ts ./_prisma/prisma.config.ts
COPY docker-entrypoint.mjs ./docker-entrypoint.mjs

# VOLUME creates the mount point in the image (no `mkdir` — distroless has no shell).
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# The distroless nodejs ENTRYPOINT is ["/nodejs/bin/node"], so CMD is just the
# launcher script: it runs `prisma migrate deploy`, then boots server.js.
CMD ["docker-entrypoint.mjs"]
