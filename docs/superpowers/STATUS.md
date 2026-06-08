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

### M3 — Deepen the Agent Loop + SSO + Suggestions  ✅ shipped (all on `main`)

Roadmap: `specs/2026-06-06-quorum-ai-m3-roadmap.md`; per-phase design specs `specs/2026-06-06-quorum-ai-m3-p1..p6-*-design.md`. All six phases implemented and on `main`. Full suite green: 150 unit + 21 e2e, lint + typecheck clean, production build 0/0.
- **P1 · Foundations & durable outbox** ✅ — durable `OutboxJob` table + in-process tick worker (backoff/dead-letter, `onDead`); email digest re-homed onto it; FK indexes; `Annotation.severity`/`category` + `SEVERITIES`. `lib/outbox.ts`.
- **P2 · Structured feedback contract** ✅ — `schemaVersion` JSON with severity/category, provenance, rollups + include/exclude filtering on `/api/plans/[id]/feedback`; `/pull-feedback` leads with blockers. `lib/feedback.ts`. _The moat._
- **P3 · Block-until-approved long-poll** ✅ — `GET …/feedback/wait?timeoutMs=` over the event bus with on-connect DB re-check + clamped timeout; skill loops to a decision.
- **P4 · Outbound webhooks** ✅ — `Webhook` model, AES-256-GCM reveal-once secret, HMAC-signed delivery via the P1 outbox handler, SSRF guard, retry/dead-letter, management UI. `lib/webhooks.ts`.
- **P5 · Suggestions-as-edits** ✅ — `Annotation.suggestedText` + `appliedInVersion`; owner-only apply route → new version via `createVersion()`; orphan/resolved guards; suggest-edit + diff-card UI; provenance surfaced in feedback.
- **P6 · Generic OIDC login** ✅ — env-gated generic OIDC provider alongside password, link-by-verified-email, self-service register guarded under SSO; no schema change (reuses `Account`). _ADR candidate — confirm an ADR was drafted._

Deferred → M5+: Postgres & multi-instance · teams/org & multi-tenancy · presence/live "review together" · git export · dedicated Slack/Teams formatters (beyond generic webhooks) · enforced-SSO / multiple-provider / SCIM · version checkpointing/compaction · multi-hunk suggestion patches.

### M4 — Governance, Lifecycle & Notification Polish  🚧 in progress

Roadmap: `specs/2026-06-08-quorum-ai-m4-roadmap.md`. P1–P3 implemented (executed in dedicated sessions per their `.tasks.json`). Two operational phases (P4, P5) surfaced mid-milestone and are now planned (specs + plans + `.tasks.json`), ready to execute.
- **P2 · resolved-comment marker bug** ✅ — shipped (`buildHighlightRanges()` excludes RESOLVED threads).
- **P1 · Ownership governance** ✅ — implemented (block owner verdicts 403 + hide UI; owner-only hard delete via transactional ordered delete).
- **P2 · Edit-UI flag** ✅ — implemented (`EDIT_UI_ENABLED`, UI-only, default on).
- **P3 · Live notifications** ✅ — implemented (per-user SSE stream + tab-title count + opt-in Web Notifications; `User.desktopNotifications`).
- **P4 · Health & readiness probes** 📋 planned — `/healthz` (liveness) + `/readyz` (DB `SELECT 1`) + Docker/compose healthcheck + k8s probe docs. Spec `…m4-p4-health-probes-design.md`; plan `…m4-p4-health-probes.md` (2 tasks).
- **P5 · Generic env vars** 📋 planned — hard rename `BETTER_AUTH_URL`→`BASE_URL`, `BETTER_AUTH_SECRET`→`AUTH_SECRET`; wire into `betterAuth()` explicitly; `baseUrl()` helper. Spec `…m4-p5-generic-env-vars-design.md`; plan `…m4-p5-generic-env-vars.md` (3 tasks).

Execute P4/P5 each in its own session, e.g. `/superpowers-extended-cc:executing-plans docs/superpowers/plans/2026-06-08-quorum-ai-m4-p4-health-probes.md`. Independent; any order. Note: P5 is a **breaking** env rename.

## Git state
- `main`: M1 + M2 + M3 all landed. M3's six phases merged into `main` (per-phase branches `m3-p1`…`m3-p6`).
- No active feature branches locally. Merged feature branches may still exist on `origin` (cleanup optional). User manages pushes.

## Run locally
```
cp .env.example .env          # set AUTH_SECRET to 32+ random chars
CI=true pnpm install
pnpm db:migrate               # apply migrations to ./data/app.db
pnpm dev                      # http://localhost:3000
```
Container: `AUTH_SECRET=$(openssl rand -base64 32) docker compose up`.

## Next action
M4 P1–P3 are implemented. P4 (health probes) + P5 (generic env vars) are planned (specs + plans + `.tasks.json`). Next: **execute P4 and P5 in dedicated sessions** in a fresh worktree off `main`, e.g. `/superpowers-extended-cc:executing-plans docs/superpowers/plans/2026-06-08-quorum-ai-m4-p4-health-probes.md`. Independent — any order. P5 is a **breaking** env rename (`BETTER_AUTH_*` → `BASE_URL`/`AUTH_SECRET`).

## Env/workflow notes (carried from M1)
- This repo's **pnpm is v11** → prefix script runs with `CI=true` (avoids the no-TTY `node_modules` purge abort).
- **Free port 3000** before `pnpm test:e2e` (`lsof -ti tcp:3000 | xargs -r kill -9`) so the webServer rebuilds.
- **Preserve test selectors** (`data-testid`/`aria-label`/button names) when touching UI.
- Create an isolated worktree at execution time; **rebase onto `main`** (don't merge main in).
- Pure libs → services → thin routes → client; value-sets in `lib/enums.ts`.

## Known follow-ups / deferrals
- FK indexes — ✅ done in M3 / P1.
- README quickstart — refreshed in M3 / P6 (verify it covers the full agent-loop + OIDC env).
- M3 / P6 was flagged an ADR candidate (OIDC auth-architecture) — confirm an ADR was drafted, else draft via the `adr` skill.
- New `OIDC_*` / `OUTBOX_*` / webhook env vars — ensure `.env.example` + deploy docs cover them.
