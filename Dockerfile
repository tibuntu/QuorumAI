# syntax=docker/dockerfile:1
# NOTE: The runtime runs the Next.js standalone bundle (self-contained app) plus
# an isolated minimal Prisma CLI under /app/_prisma used only for migrate deploy.
# The generated Prisma client lives at /app/generated/prisma (per schema output).

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

# Minimal Prisma CLI for `migrate deploy` on startup, installed with npm so the
# tree is flat and symlink-free. openssl must be present so Prisma's platform
# detection bakes the engine MATCHING the runtime (debian-openssl-3.0.x); without
# it, detection falls back to 1.1.x and Prisma would try to download the right
# engine on start — which fails on a read-only / non-root filesystem. mysql2 and
# postgres are dropped: this app is SQLite and never loads them.
FROM base AS migrator
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /migrator
COPY docker/migrator/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock \
 && rm -rf node_modules/mysql2 node_modules/postgres

FROM base AS runner
# openssl provides libssl3 for Prisma's schema engine (apt's build is current,
# so no manual patching is needed and trivy stays clean).
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/app.db"
ENV PORT=3000
# Next standalone server.js binds to $HOSTNAME, which Docker auto-sets to the
# container ID — leaving the server off loopback so the HEALTHCHECK's 127.0.0.1
# probe is refused. Bind to all interfaces (Next's documented config).
ENV HOSTNAME="0.0.0.0"

# App runtime: the Next standalone output is self-contained — server.js plus a
# trimmed, traced node_modules (incl. @prisma/client, the better-sqlite3 adapter
# and its native binary). No dev dependencies, so no dev-dep CVEs ship.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/generated ./generated

# Isolated Prisma CLI used only for `migrate deploy` on start. Kept entirely
# under /app/_prisma (its own node_modules + schema + config) so nothing here
# touches the standalone node_modules. The CMD runs prisma with this directory
# as cwd, so prisma.config.ts resolves `prisma/config` / `dotenv/config` locally
# and auto-discovers prisma/schema.prisma + migrations.
COPY --from=migrator /migrator/node_modules ./_prisma/node_modules
COPY --from=builder /app/prisma ./_prisma/prisma
COPY --from=builder /app/prisma.config.ts ./_prisma/prisma.config.ts

VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply migrations from the isolated Prisma dir, then start the standalone server.
CMD ["sh", "-c", "cd /app/_prisma && node node_modules/prisma/build/index.js migrate deploy && cd /app && exec node server.js"]
