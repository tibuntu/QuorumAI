# Quorum AI — Build Status & Resume Guide

_Snapshot for pausing/resuming. Quorum AI = "PR review for the **plan**, before the agent builds." Full design: `docs/superpowers/specs/2026-06-04-quorum-ai-design.md`._

## Milestones

### M1 — Review Core + Packaging + UI  ✅ shipped (all merged to `main`)

| Phase | Plan | PR |
|-------|------|----|
| Foundation | `plans/2026-06-04-quorum-ai-foundation.md` | merged |
| CI & Docker | `plans/2026-06-04-quorum-ai-ci-and-docker.md` | merged |
| Review Core pt 1 (documents/annotations/threads/verdicts) | `plans/2026-06-04-quorum-ai-review-core.md` | #16 |
| Review Core pt 2 (versioning/re-anchoring/live SSE) | `plans/2026-06-05-quorum-ai-review-core-part-2.md` | #17 |
| Review Core pt 3 (machine API/feedback/notifications/packaging) | `plans/2026-06-05-quorum-ai-review-core-part-3.md` | #18 |
| UI Polish ("Violet consensus") | `plans/2026-06-05-quorum-ai-ui-polish.md` | #19 |

The full hero loop works: `/push-plan` → team review (annotate, thread, resolve, verdict) → `/pull-feedback`, with editing→versions + re-anchoring, live SSE, in-app notifications, Bearer-token machine API, and a production-grade themed UI. ~30 unit tests + e2e (auth, review, versioning, integration, navigation) green; Docker/compose packaged.

### M2 — Access Control & Collaboration Polish  ✅ shipped (all on `main`)

Roadmap: `specs/2026-06-05-quorum-ai-m2-roadmap.md`. All four phases landed on `main` (committed directly; UI-review remediation + CI GHCR push merged via PR #21/#22). Full suite green: 60 unit + 16 e2e, lint + typecheck clean, production build 0/0.
- **P1 · Authorization** ✅ — per-document/plan access (owner + participants) on web + machine API; closed the M1 open-access gap (STRIDE register → verified). `lib/authz.ts`, `DocumentParticipant`, token expiry/scope.
- **P2 · Email notifications** ✅ — transactional, env-gated SMTP, per-user on/off; `lib/email*.ts` + per-(user,doc) debounce; settings sub-nav.
- **P3 · Version history + diff view** ✅ — versions list + side-by-side markdown diff; `lib/diff.ts`, history route.
- **P4 · Dark-mode toggle** ✅ — class-based light/dark/system tokens, no-flash boot script, header toggle; `lib/theme.ts`, `ThemeToggle`.

### M3 — Deepen the Agent Loop + SSO + Suggestions  📋 roadmap defined, not started

Roadmap: `specs/2026-06-06-quorum-ai-m3-roadmap.md`. Per-phase design specs drafted (`specs/2026-06-06-quorum-ai-m3-p1..p6-*-design.md`). Phases (P1 first — foundation; P2/P3/P5/P6 parallelizable after; P4 needs P1):
- **P1 · Foundations & durable outbox** — `OutboxJob` table + in-process worker (retry/backoff/dead-letter); email digest re-homed onto it; missing FK indexes; `Annotation.severity`/`category`. _Foundation for P4._
- **P2 · Structured feedback contract** — versioned filterable JSON (severity/category, provenance, rollups) on `/api/plans/[id]/feedback`. _The moat._
- **P3 · Block-until-approved long-poll** — `GET …/feedback/wait?timeoutMs=`; `/pull-feedback` skill loops to a decision.
- **P4 · Outbound webhooks** — signed (HMAC), durable, retried delivery via the P1 outbox; CI/agent callbacks on review events.
- **P5 · Suggestions-as-edits** — reviewer proposes concrete text; owner accepts → new version via `createVersion()`.
- **P6 · Generic OIDC login** — one env-gated OIDC provider alongside password; account-linking by verified email (no schema change). _ADR candidate._

Deferred → M4+: Postgres & multi-instance · teams/org & multi-tenancy · presence/live "review together" · git export · dedicated Slack/Teams formatters (beyond generic webhooks) · enforced-SSO / multiple-provider / SCIM · version checkpointing/compaction · multi-hunk suggestion patches.

## Git state
- `main`: all M1 work merged (PRs #16–#19) + this roadmap.
- No active feature branches locally. Merged feature branches may still exist on `origin` (cleanup optional). User manages pushes.

## Run locally
```
cp .env.example .env          # set BETTER_AUTH_SECRET to 32+ random chars
CI=true pnpm install
pnpm db:migrate               # apply migrations to ./data/app.db
pnpm dev                      # http://localhost:3000
```
Container: `BETTER_AUTH_SECRET=$(openssl rand -base64 32) docker compose up`.

## Next action
M2 is complete. Start **M3 / P1 (Foundations & durable outbox)** — fresh session on a fresh branch off `main`: `brainstorming` → `writing-plans` → execute (see the M3 roadmap's "Per-phase workflow"). P1 ships first (foundation for P4); P2/P3/P5/P6 parallelize after.

## Env/workflow notes (carried from M1)
- This repo's **pnpm is v11** → prefix script runs with `CI=true` (avoids the no-TTY `node_modules` purge abort).
- **Free port 3000** before `pnpm test:e2e` (`lsof -ti tcp:3000 | xargs -r kill -9`) so the webServer rebuilds.
- **Preserve test selectors** (`data-testid`/`aria-label`/button names) when touching UI.
- Create an isolated worktree at execution time; **rebase onto `main`** (don't merge main in).
- Pure libs → services → thin routes → client; value-sets in `lib/enums.ts`.

## Known follow-ups / deferrals
- FK indexes (`Annotation.authorId`, `Comment.authorId`, `Review.reviewerId`, `DocumentVersion.createdById`) — **folded into M3 / P1**.
- README quickstart still references pre-M1 state — update to the real `docker compose up` + agent-loop flow (**M3 / P6** also touches README).
- `gsd-ui-review` visual audit — **landed via PR #21** (UI-review remediation).
- Stale local branches/worktree to prune: `ui-review-remediation` (merged → PR #21), `worktree-docker-push-action` (merged → PR #22).
