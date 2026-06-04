# Quorum AI — CI & Docker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development or superpowers-extended-cc:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (1) A GitHub Actions CI pipeline that runs lint + unit tests + build (and e2e) on every push/PR to `main`, plus a Docker image build; (2) a single-container Dockerfile + docker-compose that runs Quorum AI with an embedded SQLite DB on a mounted volume, migrating on start — delivering the "deploy as one Docker container" promise.

**Architecture:** CI uses pnpm + Node 24 with caching. The Dockerfile is a 3-stage build (deps → builder → runner) using Next.js `output: "standalone"`; native `better-sqlite3` is compiled in the deps/builder stages; the runner copies the standalone server + static/public + Prisma schema/migrations and runs `prisma migrate deploy && node server.js` against `/data/app.db` on a named volume.

**Tech Stack:** GitHub Actions, pnpm/corepack, Docker (multi-stage), Next.js 16 standalone, Prisma 7, better-sqlite3.

**Independence:** This plan does NOT depend on Review-core; it can run against the current Foundation app. It is best done early so CI guards every subsequent PR.

**Conventions:** plain commits (no AI attribution trailer); SCM Breeze shell (use Write/Edit, single-line Bash); stay on the feature branch; do not push unless asked.

**Key constraint — `output: standalone` vs `next start`:** Foundation deferred `output: standalone` because `next start` warns under it. This plan **re-adds `output: "standalone"`** (Docker needs it) and switches the production run path to `node .next/standalone/server.js`. `next start` still serves under standalone (with a warning) so the existing Playwright `webServer` keeps working; CI e2e is unaffected.

---

### Task 1: Dockerfile + docker-compose (single-container, migrate-on-start)

**Goal:** `docker compose up` builds and runs Quorum AI on `http://localhost:3000` with SQLite persisted to a named volume, applying migrations on start.

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`
- Modify: `next.config.ts` (re-add `output: "standalone"`)

**Acceptance Criteria:**
- [ ] `docker build -t quorum-ai .` succeeds (better-sqlite3 compiles; `next build` runs; `prisma generate` runs)
- [ ] `docker compose up` serves the app; `/login` returns HTTP 200; registering a user persists across `docker compose down && up` (volume)
- [ ] Migrations apply automatically on container start (`prisma migrate deploy`)
- [ ] `BETTER_AUTH_SECRET` is read from env (compose passes it); `DATABASE_URL=file:/data/app.db`

**Verify:** `docker build -t quorum-ai .` then `docker compose up -d` and `curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000/login` → `200`. (If Docker is unavailable on the dev machine, state that and rely on the CI image-build job from Task 2 — but author the files precisely.)

**Steps:**

- [ ] **Step 1: Re-add standalone output** — `next.config.ts`:
```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-better-sqlite3", "better-sqlite3"],
};
export default nextConfig;
```

- [ ] **Step 2: `.dockerignore`**
```
node_modules
.next
.git
data
*.db
*.db-wal
*.db-shm
.env
.env.*
playwright-report
test-results
coverage
```

- [ ] **Step 3: `Dockerfile`** (Debian slim for reliable native builds; adjust if you prefer alpine + build-base)
```dockerfile
# syntax=docker/dockerfile:1

FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

# deps: install with native build toolchain for better-sqlite3
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# builder: generate Prisma client + build Next (standalone)
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm dlx prisma generate
RUN pnpm build

# runner: minimal image with the standalone server + assets + prisma for migrations
FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/app.db"
ENV PORT=3000

# standalone server + static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# generated Prisma client (output: generated/prisma) is traced into standalone node_modules by Next;
# if not, copy it explicitly:
COPY --from=builder /app/generated ./generated
# prisma schema + migrations + CLI for migrate deploy on start
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

RUN mkdir -p /data
VOLUME /data
EXPOSE 3000

# migrate then start the standalone server
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
```
> **Implementer note:** the exact set of files to copy for `prisma migrate deploy` to run in the runner (prisma CLI path, engines) is the fiddly part — verify empirically with `docker build` + `docker run`. If `node node_modules/prisma/build/index.js migrate deploy` path differs, use `pnpm dlx prisma migrate deploy` with prisma copied, or a dedicated migrate stage. The goal: migrations apply on start and `node server.js` serves. Confirm better-sqlite3's `.node` binary is present under the standalone `node_modules` (Next traces it; if missing, copy `node_modules/better-sqlite3`).

- [ ] **Step 4: `docker-compose.yml`**
```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: "file:/data/app.db"
      BETTER_AUTH_SECRET: "${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET}"
      BETTER_AUTH_URL: "http://localhost:3000"
    volumes:
      - quorum-data:/data
volumes:
  quorum-data:
```

- [ ] **Step 5: Verify** (if Docker available): `docker build -t quorum-ai .`; `BETTER_AUTH_SECRET=$(openssl rand -base64 32) docker compose up -d`; `curl` `/login` → 200; register via browser/curl; `docker compose down && docker compose up -d`; confirm the user persisted. Then commit: `feat: add Dockerfile and docker-compose for single-container deploy`.

---

### Task 2: GitHub Actions CI

**Goal:** On push/PR to `main`: install, lint, unit tests, build, e2e, and a Docker image build — all green.

**Files:**
- Create: `.github/workflows/ci.yml`

**Acceptance Criteria:**
- [ ] `lint-test-build` job: pnpm install (cached) → `pnpm lint` → `pnpm test:unit` → `pnpm build`, all pass
- [ ] `e2e` job: installs Playwright browsers, sets env (`BETTER_AUTH_SECRET`, `DATABASE_URL`), runs `prisma migrate deploy`, runs `pnpm test:e2e`
- [ ] `docker` job: `docker build` succeeds (uses Task 1's Dockerfile)
- [ ] Workflow is valid YAML and triggers on push + pull_request to `main`

**Verify:** `actionlint .github/workflows/ci.yml` if available, else YAML-lint; the real check is a green run on GitHub after push.

**Steps:**

- [ ] **Step 1: `.github/workflows/ci.yml`**
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-test-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test:unit
      - run: pnpm build
        env:
          DATABASE_URL: "file:./data/app.db"

  e2e:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: "file:./data/app.db"
      BETTER_AUTH_SECRET: "ci-secret-not-for-production-32chars"
      BETTER_AUTH_URL: "http://localhost:3000"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: mkdir -p data && pnpm dlx prisma migrate deploy
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          tags: quorum-ai:ci
```
> **Implementer notes:** (a) `pnpm build` and the `prisma generate` postinstall need a `DATABASE_URL` present — env is set. (b) If `pnpm lint` (next lint) is interactive/needs config on first run, ensure it's non-interactive (eslint config exists from Foundation). (c) The `e2e` job uses Linux Playwright (`--with-deps` is correct here, unlike local macOS). (d) The `pnpm.overrides` (better-call/kysely) are in package.json, so `--frozen-lockfile` installs reproduce them.

- [ ] **Step 2: Validate + commit.** Run `actionlint` if installed (else eyeball the YAML). Commit: `ci: add GitHub Actions pipeline (lint, test, build, e2e, docker)`.

---

## Self-review
- **Coverage:** Dockerfile + compose + standalone re-add ✓(T1); CI lint/unit/build + e2e + docker-build ✓(T2). Matches the user's "Dockerfile and GitHub actions" ask.
- **Placeholders:** concrete file contents provided; the genuinely environment-sensitive bits (Prisma migrate path inside the runner; better-sqlite3 native trace; first-run lint) are called out with explicit empirical-verify gates rather than hand-waved.
- **Consistency:** Node 24 + pnpm + `output: standalone` + `DATABASE_URL=file:/data/app.db` are consistent across Dockerfile, compose, and CI; volume `quorum-data` ↔ `/data`.

## Notes
- The README quickstart (`docker compose up`) becomes real after Task 1 — update README setup steps as part of the next docs pass.
- When the Integration & packaging milestone adds the machine API + `/push-plan`/`/pull-feedback` + notifications, no Docker change is needed beyond env for any new secrets.
