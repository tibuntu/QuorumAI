# Quorum AI — Design Spec

**Date:** 2026-06-04 · **Status:** Approved (M1 in progress) · **Source of truth for implementation.**

> This spec is the validated design from the kickoff brainstorm. The approved plan lives at `~/.claude/plans/hi-claude-inspired-by-wondrous-aurora.md`; this file is the in-repo canonical version.

---

## 1. Context — why we're building this

> 📌 **README seed (preserve verbatim):** The next two paragraphs are canonical positioning, carried word-for-word into `README.md`.

Agentic AI made each developer a silo. Every dev now drives a private Claude Code session whose context and output are invisible to teammates; plans, specs, and tickets get generated and approved by one human + one agent, then implemented — with no point where the **team's** collective judgment enters. The cross-perspective review that made teams strong (a cloud engineer catching an infra problem in a backend dev's approach, a senior's judgment rubbing off on a junior) quietly disappeared. Agentic AI became a fantastic individual force-multiplier and an accidental **collaboration-killer**.

This product re-inserts the team at the highest-leverage moment: **before the agent acts.** It is, in one line, **"pull-request review, but for the *plan* (and the ticket) — before the agent implements."** A developer's agent drafts a plan; instead of solo-approving it, the artifact goes up for **async team review**; the cloud/frontend/backend reviewers weigh in without a meeting; consolidated feedback flows **back into the agent**, which revises, then implements.

**Differentiation (landscape-validated):** no product owns "distributed-team consensus on the plan before execution." Plandex is single-user; Cursor/Windsurf are IDE-locked and execution-focused; Devin/Augment/Tessl review *after* the agent acts (PR-time); Plannotator is single-device and solo. Quorum AI's wedge is exactly the unclaimed gap.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| First artifact | Generic markdown (plans, tickets, skills all treated as markdown docs) |
| Collaboration model | Async annotate & comment (PR-review style); real-time/live is a later phase |
| Hero loop | "Before" review gate — team reviews/refines the plan/ticket before the agent builds |
| Access model | Open instance — any logged-in user sees/edits/comments every doc |
| Auth | Local email+password now, OIDC/SSO later (no re-architecture) |
| Editing | Direct in-app editing with version history (save-based, not CRDT) |
| Plan storage | App DB-native, no git — plans live only in the app |
| MVP integration depth | Full hero loop — `/push-plan` + `/pull-feedback` ship in M1 |
| Review UX | Rendered markdown + text-quote anchoring (Hypothesis-style) |
| Notifications (M1) | In-app inbox + shareable deep link; optional email (SMTP). Slack/Teams deferred to M2 |
| Agent wait model | Post-and-resume (agent posts plan, hands control back; resumes via `/pull-feedback`). NOT blocking |
| Deploy | Single Docker container, embedded SQLite, no external services |

## 3. Stack

- **Next.js 16** (App Router, `output: "standalone"`) — one Node process serves UI + API. _(Scaffold pulled the current stable 16.x; patterns we use are App-Router-stable across 15→16.)_
- **Prisma 6.16+** (TypeScript/WASM engine — no platform binaries in Docker) + **SQLite** (one file on a named volume, `journal_mode=WAL`).
- **better-auth** — `emailAndPassword` now; OIDC/OAuth plugins drop in later without rework. DB-backed sessions in SQLite. **Argon2id** hashing.
- **CodeMirror 6** — markdown source editor (EDIT mode).
- **react-markdown (remark/rehype)** — rendered review view; annotations anchor to **rendered text** via a Hypothesis-style text-quote layer (`exact` + `prefix`/`suffix`), independent of the editor (avoids fragile source↔HTML offset mapping).
- **Server-Sent Events (SSE)** — live comment/annotation/verdict updates. 30s heartbeats, per-IP caps, `export const dynamic = "force-dynamic"`.
- **pnpm / Vitest / Playwright / tsc.**
- **Packaging:** 3-stage Dockerfile (deps → build → runner); `prisma migrate deploy && node server.js` at container start; `docker compose up` with a named volume at `/data`.

### Approaches considered
- **A — DB-native Next.js monolith, post-and-resume (CHOSEN).** Best thesis fit + simplest self-host.
- **B — Git-native (PLAN.md in a repo).** Rejected for MVP: more coupling, trickier anchoring, heavier setup. (Optional git export may return later.)
- **C — Slack-first / chat-native.** Rejected as primary: chat threads are poor for anchored annotation + versioning. Slack/Teams return later as a notification layer only.

## 4. Architecture

```
┌── Claude Code session ───────────┐        ┌── Quorum AI (single container) ───────────┐
│  /push-plan  ──POST /api/plans──────────▶ │  Next.js (UI + API)  ·  better-auth         │
│  (agent posts plan, returns control)      │  Prisma ▸ SQLite (/data/app.db, WAL)        │
│                                  │        │  Anchoring · Feedback-consolidation · SSE   │
│  /pull-feedback ◀─GET /feedback───────────│  Notifications (in-app inbox; email opt.)   │
└──────────────────────────────────┘        └──────────────────────────────────────────┘
        ▲ consolidated team feedback                 ▲ web UI: review/annotate/approve
                                                     │
                          Distributed reviewers (FE / BE / cloud) in the browser
```

### 4.1 Data model (Prisma — minimal, extensible)
- **User**: id, email (unique, lower-cased), passwordHash, displayName, role(`admin`|`member`), createdAt. (+ better-auth session/account tables.)
- **ApiToken**: id, userId, tokenHash, label, lastUsedAt, createdAt. (Bearer auth for `/push-plan` + `/pull-feedback`.)
- **Document**: id, title, ownerId, state(`DRAFT`|`OPEN`|`CHANGES_REQUESTED`|`APPROVED`|`CLOSED`), currentVersionId, requiredApprovals(default 1), source(`WEB`|`CLAUDE_CODE`), agentContext(optional — snapshot re-injected on resume), createdAt, updatedAt.
- **DocumentVersion**: id, documentId, versionNumber, markdown, contentHash, createdById, createdAt. (Full snapshots for M1; checkpointing later.)
- **Annotation**: id, documentId, createdOnVersionId, kind(`COMMENT`|`SUGGESTION`), anchorExact, anchorPrefix, anchorSuffix, startOffset, endOffset (hints, in rendered text), status(`ACTIVE`|`MOVED`|`ORPHANED`), threadStatus(`OPEN`|`RESOLVED`), authorId, createdAt. (Null anchor ⇒ doc-level comment.)
- **Comment**: id, annotationId, authorId, body(markdown), createdAt. (Thread = comments sharing annotationId, ordered by time.)
- **Review**: id, documentId, reviewerId, verdict(`APPROVE`|`REQUEST_CHANGES`|`COMMENT`), onVersionId, dismissed(bool), createdAt.

**State logic:** `APPROVED` when active `APPROVE` count ≥ requiredApprovals **and** no active `REQUEST_CHANGES`. On a new version with a non-editorial diff (ignore whitespace/typos), dismiss prior approvals and notify reviewers. Authors can't approve their own doc.

### 4.2 Annotation anchoring (the hard part)
Store each anchor as a text-quote (`exact` + ~32-char `prefix`/`suffix`) captured from the **rendered** text, plus rendered-text offset hints. On a new version, re-anchor with a 4-step fallback: (1) offset hint valid ⇒ keep; (2) exact `prefix+exact+suffix` found ⇒ move; (3) fuzzy context match ⇒ move (mark confidence); (4) fail ⇒ **ORPHANED**, shown with a warning + the original snippet (never silently misplaced). Confidence enum: `EXACT`/`CONTEXT_FUZZY`/`TEXT_FUZZY`/`ORPHANED`. Concurrency: PATCH carries `baseVersion`; stale writes rejected (optimistic locking).

### 4.3 Claude Code integration (post-and-resume)
**Skills/commands** (shipped as installable command files; read `QUORUM_URL` + `QUORUM_TOKEN` from env or `~/.claude` settings):
- **`/push-plan [file]`** — posts the current plan (from `ExitPlanMode` context, last assistant message, or a file arg) → `POST /api/plans` → prints review URL + plan id, returns control (no blocking).
- **`/pull-feedback <plan_id>`** — `GET /api/plans/:id/feedback`; injects consolidated feedback into the session so Claude revises. Optionally polls until `decision != pending` or a timeout.

**Machine API (Bearer token):**
- `POST /api/plans` → `{id, reviewUrl}` (title, markdown, agentContext, optional deadline). Idempotent re-POST with id ⇒ new version.
- `GET /api/plans/:id/feedback` → `FeedbackSummary`: `{decision: pending|approved|needs_revision, approvals[], changeRequests[], annotations[{quotedText, context, comment, author, kind}], unresolvedCount, currentVersion}`.
- `GET /api/plans/:id/feedback/stream` → SSE.
- `PATCH /api/plans/:id` → agent posts a revised version.

**Web/session API:** documents CRUD + new-version PATCH (re-anchor + approval-dismissal); annotations + comments + reviews; `GET /api/documents/:id/stream` (SSE). Auth via better-auth session cookie. A **Settings → API tokens** page generates a token and shows the exact `/push-plan` + `/pull-feedback` setup snippet.

### 4.4 Notifications (M1 minimal)
- **In-app inbox**: open docs, docs where I'm an active reviewer, docs with new activity since last seen.
- **Shareable deep links**: `/documents/:id#annotation-:aid` scrolls + highlights; paste into any chat.
- **Optional email** (Nodemailer + SMTP env, off by default).
- **Deferred to M2:** Slack Incoming Webhook + Teams (Power Automate "Workflows") via a generic webhook-notifier abstraction.

## 5. Scope

**M1 (proves the thesis, end-to-end):** local accounts + open instance · create/paste a doc **or** `/push-plan` · rendered review view with select-to-comment, threads, resolve · Approve / Request-changes with aggregation + stale-approval dismissal · direct editing → new version → re-anchoring (+ orphan handling) · in-app inbox + deep links (+ optional email) · `/pull-feedback` returns consolidated feedback · live updates via SSE · single Docker container.

**M2+ (seams now, build later):** suggestions-as-applyable-edits · Slack/Teams webhooks · OIDC/SSO · email digests + prefs · multi-workspace/multi-tenancy · presence + live "review together" sessions · optional git export · version checkpointing/compaction · Postgres migration path.

## 6. Risks & mitigations
- **New-ritual adoption:** keep friction near-zero (instant deep link, one-click approve, agent unblocked immediately); validate value with real use.
- **Agent resume context loss:** persist `agentContext`; re-inject on `/pull-feedback`.
- **Anchor reliability:** robust 4-step re-anchor + explicit ORPHANED state; DB-native + edit-in-app avoids out-of-band edits.
- **SQLite ceiling:** keep a clean Postgres migration path (Prisma); document it.
- **Concurrent edits:** optimistic concurrency via `baseVersion`; conflict surfaced, not lost.
- **SSE pitfalls:** disable proxy buffering, heartbeats, per-IP caps, validate session before streaming.

## 7. Verification
1. **Unit (Vitest):** anchoring round-trips (edit before/after/overlap, delete → re-anchor vs. ORPHANED); feedback-consolidation shape; review-state transitions incl. stale-approval dismissal.
2. **E2E (Playwright):** two users → A creates doc → B comments + requests changes → A edits (new version) and B's annotation re-anchors → B approves → state `APPROVED`; deep link scrolls/highlights.
3. **Integration (hero loop):** `POST /api/plans` → inbox → annotate + Request-changes → `GET /feedback` consolidated → `PATCH` revision → approvals dismissed.
4. **Manual / container:** `docker compose up` → run the full loop; from a real Claude Code session run `/push-plan`, review, `/pull-feedback`, confirm feedback lands back.
