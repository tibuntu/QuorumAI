# Quorum AI — Build Status & Resume Guide

_Snapshot for pausing/resuming. Quorum AI = "PR review for the **plan**, before the agent builds." Full design: `docs/superpowers/specs/2026-06-04-quorum-ai-design.md`._

## Milestones

| Milestone | Plan | State |
|-----------|------|-------|
| **Foundation** | `plans/2026-06-04-quorum-ai-foundation.md` | ✅ Done — **merged to `main`** |
| **CI & Docker** | `plans/2026-06-04-quorum-ai-ci-and-docker.md` | ✅ Built — on branch **`ci-and-docker`** (UNMERGED); image build + CI run not yet validated on a real runner |
| **Review core (pt 1)** | `plans/2026-06-04-quorum-ai-review-core.md` | ⏳ Planned — tasks RC1–RC7 pending (not started) |
| Review core (pt 2) | _not yet written_ | editing + versioning + cross-version re-anchoring + live SSE |
| Integration & packaging | _not yet written_ | machine API + `/push-plan`·`/pull-feedback` skills + notifications |

## Git state
- `main`: Foundation (8 commits) + the three plan docs + `renovate.json`. (User is managing pushes to `origin`.)
- `ci-and-docker` (branched from `main`): `aa80277` Dockerfile/compose + standalone re-add, `99da676` dotenv-in-runner fix, `bb91dbb` GitHub Actions CI. **Not merged.**

## What works today (Foundation, on `main`)
Register → authenticated `/app` shell → sign-out, guarded by `proxy.ts` + server session check. Next.js 16 + Prisma 7/SQLite (WAL) + better-auth (email+password, DB sessions, `role`). Full M1 schema present. 4 unit tests + 1 Playwright e2e green; `next build` clean.

## Run locally
```
cp .env.example .env          # set BETTER_AUTH_SECRET to 32+ random chars
pnpm install
pnpm db:migrate               # apply migrations to ./data/app.db
pnpm dev                      # http://localhost:3000
```
Container (after merging `ci-and-docker`): `BETTER_AUTH_SECRET=$(openssl rand -base64 32) docker compose up`.

## Open actions (next session)
1. **Validate CI & Docker:** merge `ci-and-docker` and push to GitHub → the `CI` workflow runs lint/unit/build + e2e (Linux) + `docker build`. This is where the Docker image build and the `migrate-on-start` path get validated (couldn't run locally — Docker daemon was down).
2. **Execute Review core (pt 1):** resume with subagent-driven-development or:
   `/superpowers-extended-cc:executing-plans docs/superpowers/plans/2026-06-04-quorum-ai-review-core.md`
   Order: RC1 anchoring → RC2 review-state → RC3 documents API → RC4 annotations/comments → RC5 reviews → RC6 list/create UI → RC7 review view + e2e.

## Tracked deferrals / known risks
- **Docker runtime unvalidated locally** (daemon off): the runner stage's prisma-CLI path + `better-sqlite3` native trace are validated by the CI `docker` job — watch its first run.
- Convert `Annotation.createdOnVersionId` / `Review.onVersionId` to real FKs when independent version ops arrive (Review-core pt 2).
- Add indexes on author/reviewer FK columns (`Annotation.authorId`, `Comment.authorId`, `Review.reviewerId`, `DocumentVersion.createdById`).
- Auth UI: add submit-button disable (double-submit) + `router.refresh()` after sign-out (MVP polish).
- Vitest has no React/JSX transform yet — add `@vitejs/plugin-react` + `jsdom` when component unit tests are wanted.
- `pnpm.overrides` pin `better-call`/`kysely` for better-auth 1.6.14; `better-auth` is pinned exact. Re-check on any auth upgrade.
- Update README quickstart to the real `docker compose up` flow once CI&Docker is merged.
