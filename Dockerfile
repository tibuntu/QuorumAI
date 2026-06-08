# syntax=docker/dockerfile:1
# NOTE: The exact prisma-CLI-in-runner path (node node_modules/prisma/build/index.js)
# and better-sqlite3 native module availability are validated by the CI docker job.
# The generated Prisma client lives at /app/generated/prisma (per schema output setting).

FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

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

FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/app.db"
ENV PORT=3000
# Next standalone server.js binds to $HOSTNAME, which Docker auto-sets to the
# container ID — leaving the server off loopback so the HEALTHCHECK's
# 127.0.0.1 probe is refused. Bind to all interfaces (Next's documented config).
ENV HOSTNAME="0.0.0.0"
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# Full node_modules from the builder: pnpm uses a symlinked layout (top-level
# packages link into node_modules/.pnpm), so selectively copying prisma/@prisma
# breaks at runtime ("Cannot find module '@prisma/engines'"). Copying the whole
# tree keeps the symlink targets, so the prisma CLI resolves for `migrate deploy`
# on start. (dotenv — needed by prisma.config.ts — is included too.)
COPY --from=builder /app/node_modules ./node_modules
RUN mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
