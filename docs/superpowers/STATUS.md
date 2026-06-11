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

Deferred → M5+: Postgres & multi-instance · teams/org & multi-tenancy · presence/live "review together" · enforced-SSO / multiple-provider / SCIM · version checkpointing/compaction · multi-hunk suggestion patches.

### M4 — Governance, Lifecycle & Notification Polish  ✅ shipped

Roadmap: `specs/2026-06-08-quorum-ai-m4-roadmap.md`; per-phase design specs `specs/2026-06-08-quorum-ai-m4-p1..p5-*-design.md`. All phases implemented (executed in dedicated sessions per their `.tasks.json`).
- **P0 · resolved-comment marker bug** ✅ — `buildHighlightRanges()` excludes RESOLVED threads (in-text marker disappears; comment stays in sidebar).
- **P1 · Ownership governance** ✅ — owner can't review own document (403 + hidden verdict UI); owner-only hard delete via transactional ordered delete (handles `DocumentVersion` `Restrict` FKs); delete button + confirm modal.
- **P2 · Edit-UI flag** ✅ — `EDIT_UI_ENABLED` (server-prop, default on) hides the in-app Edit button; PATCH API ungated. `lib/config.ts` `isEditUiEnabled()`.
- **P3 · Live notifications** ✅ — global per-user SSE stream (`/api/notifications/stream`) + tab-title unread count + opt-in Web Notifications (fire only when hidden); `User.desktopNotifications`; `NotificationProvider`.
- **P4 · Health & readiness probes** ✅ — `/healthz` (liveness) + `/readyz` (DB `SELECT 1`, 503 on failure); Docker `HEALTHCHECK` + compose healthcheck (node `fetch`); k8s probe docs in README.
- **P5 · Generic env vars** ✅ — hard rename `BETTER_AUTH_URL`→`BASE_URL`, `BETTER_AUTH_SECRET`→`AUTH_SECRET`; wired into `betterAuth()` explicitly (`secret`/`baseURL`); `baseUrl()` helper DRYs origin reads; `.env.example`/compose/CI/README updated.

Deferred → M5+ (unchanged): Postgres & multi-instance · teams/org & multi-tenancy · presence/live · enforced-SSO/SCIM · admin/moderator roles · soft-delete/trash · quorum thresholds · version checkpointing · multi-hunk patches · granular per-type notification prefs.

### M5 — Real-Time Review Sessions  ✅ shipped (all on `main`)

Roadmap: `specs/2026-06-09-quorum-ai-m5-roadmap.md`; per-phase design specs `specs/2026-06-09/10-quorum-ai-m5-p1..p5-*-design.md`. All five phases implemented on `main`. Transport: SSE (server→client) + throttled POST beacon (client→server) fanned through the existing `lib/events.ts` bus — **no WebSockets**, no new infra. Presence state is ephemeral/in-memory/single-instance behind `lib/presence.ts`.
- **P1 · Presence roster** ✅ — `lib/presence.ts` registry + TTL sweep; heartbeat POST; roster snapshot on SSE connect; "N viewing" UI. Rides the existing document `EventSource` (no third connection).
- **P2 · Shared selections** ✅ — beacon carries text-selection range; other users' selections rendered via `lib/highlight.ts`.
- **P3 · Live cursors** ✅ — pointer position on the beacon (tighter throttle); floating cursor labels.
- **P4 · Session lifecycle** ✅ — explicit start/end review session with a `sessionId` + leader; `session.started/ended` events on the registry.
- **P5 · Follow-the-leader scroll** ✅ — leader broadcasts throttled scroll position; followers smooth-scroll; detach/resume.

### M6 — Review Depth & Polish  🔄 in progress (P1 + P2 shipped)

Roadmap: `specs/2026-06-10-quorum-ai-m6-roadmap.md`. Deliberately small + infra-free. Three phases:
- **P1 · General UI polish** ✅ shipped (on `main`) — ran a fresh whole-app **6-pillar re-audit** (the 2026-06-06 review was stale; all 7 of its findings already fixed). Fresh audit (`2026-06-10-quorum-ai-ui-review.md`) scored 19/24, then fixed all objective + approved-subjective findings → **23/24** (+6 vs the 17/24 baseline). Changes: dark-themed CodeMirror editor (reactive, token-driven via `lib/use-resolved-dark.ts`; theme store hoisted into `lib/theme.ts`), editor line-wrapping, violet `accent-color` on form controls, dark unchecked task-list checkbox, leading-H1 demotion (`lib/markdown-heading.ts`), presence colors → theme tokens, diff per-column version headers, session helper tooltips, cursor→person legend. 287 unit + 29 e2e green, lint/tsc/build clean. Residual (low, deferred): CodeMirror dark *syntax-token* dimness. No Settings nav button added; design system preserved. Plan: `plans/2026-06-10-quorum-ai-m6-p1-ui-polish.md`; design: `specs/2026-06-10-quorum-ai-m6-p1-ui-polish-design.md`.
- **P2 · Granular per-type notification prefs** ✅ shipped (on `main`) — replaced the two global `User` booleans with a per-(type×channel) matrix in a new `User.notificationPrefs Json?` column (Prisma 7.8 Json on SQLite). Full 3-channel matrix (in-app/email/desktop) × 4 types; `resolve` stays non-emailable. Pure `lib/notification-prefs.ts` (DEFAULT_PREFS, parsePrefs, isEnabled, isValidCell, applyPatch) is the single source of truth; dispatch (`lib/notifications.ts`) gates in-app + email per pref; desktop fires per-type client-side (`lib/notification-client.ts` + layout-sourced `desktopPrefs`); per-cell PATCH `{type,channel,enabled}`; settings matrix UI (`pref-<type>-<channel>` testids, resolve×email disabled). **Two migrations**: add+backfill `notificationPrefs` from the old booleans, then drop the booleans (data preserved, empirically verified). Defaults preserve prior behavior. 296 unit + 29 e2e green, lint/tsc/build clean. Plan: `plans/2026-06-10-quorum-ai-m6-p2-notification-prefs.md`; design: `specs/2026-06-10-quorum-ai-m6-p2-notification-prefs-design.md`.
- **P3 · Quorum / N-approver thresholds** 🔜 — expose `Document.requiredApprovals` (engine already honors it) on create/edit + machine API + progress display.

Dropped from the backlog entirely in M6: dedicated Slack/Teams formatters; git export.

## Git state
- `main`: M1–M5 + M6/P1 + M6/P2 all landed locally (each fast-forwarded in from its worktree branch, now removed). **`main` is ahead of `origin` — not yet pushed.** M6/P3 not started. **P2 added 2 migrations** — run `pnpm db:deploy` (+ `pnpm prisma generate`) on the main checkout before `pnpm dev`/tests (DB is per-checkout).
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
M6/P1 (UI polish, 23/24) and M6/P2 (granular notification prefs) are shipped on local `main`. Next: **M6 / P3 — Quorum / N-approver thresholds** in a fresh worktree via the `brainstorming` skill. The engine already honors `Document.requiredApprovals` (`lib/review-state.ts:8-13`, passed in at `lib/reviews.ts:18`) but the field is never set — so P3 is the config + display surface: owner sets the threshold on create/edit (`components/NewDocumentForm.tsx` + create route) and via the machine API (`POST /api/plans`, `PATCH /api/plans/[id]`); show "N of M approvals" progress; surface threshold+count in consolidated feedback (`lib/feedback.ts`); recompute state correctly when the threshold changes. After landing P3, M6 is complete. Standing reminder: M4/P5 was a **breaking** env rename — deploys must set `BASE_URL`/`AUTH_SECRET` before upgrading.

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
