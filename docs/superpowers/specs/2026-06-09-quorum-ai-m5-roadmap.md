# Quorum AI — M5 Roadmap: Real-Time Review Sessions

> **Status:** Approved milestone roadmap. Each phase below runs its own `brainstorming → writing-plans → execute` cycle (same as M1/M2/M3/M4 phases). This doc is the milestone-level scope + sequence, not a phase spec.
> **Follows:** M4 (ownership governance + edit-UI flag + live notifications + health probes + generic env vars) — all shipped on `main`.

## Theme

M1 made review work; M2 made it safe and pleasant; M3 sharpened the agent-in-the-loop moat; M4 tightened governance, lifecycle, and awareness. M5 adds the long-deferred **real-time, synchronous** dimension: a team can review a plan *together, live*.

What already exists: server→client live **data** sync (annotations, comments, verdicts) via SSE. What's genuinely new in M5 is **awareness** (who's present, where they're reading/selecting) and **session mechanics** (a guided review session with a leader and follow-the-leader scrolling).

M5 stays inside the project's "single Next process, no extra infra" ethos. It does **not** touch the remaining big deferred items (Postgres/multi-instance, multi-tenancy, git export, Slack/Teams formatters, enforced-SSO/SCIM) — those stay deferred to M6+.

## Transport decision (resolved before phasing)

**SSE for server→client + throttled POST for client→server, fanned out through the existing `lib/events.ts` event bus. NOT WebSockets.**

- The Dockerfile runs Next's **generated standalone `server.js`**. WebSockets require a hand-rolled custom server, abandoning standalone's module-tracing/static-serving — a direct violation of the deployment ethos.
- SSE+POST adds **zero new dependencies and zero new processes**. Reviewers read at human pace, so throttled POST (~5Hz selection/heartbeat, tighter for cursors) is ample.

Two hard constraints carried into every phase:
- **Presence rides the existing `/api/documents/[id]/stream` connection — do NOT open a third `EventSource`.** A tab already holds 2 (document + notifications) against the HTTP/1.1 6-connection-per-origin cap.
- **Presence state is ephemeral, in-memory, single-instance** — correct now. Hide it behind a module interface (`lib/presence.ts`) so a later Redis/Postgres-backed impl can swap in when multi-instance lands.

## Foundation (shared by all phases)

- **`lib/presence.ts`** (new) — module-level singleton, `globalThis`-stashed exactly like `lib/events.ts:23-26` (survives dev hot-reload). Shape: `Map<documentId, Map<userId, PresenceEntry>>`, `PresenceEntry = { userId, name, cursor?, selection?: {start,end}, lastSeen, sessionRole? }`. API: `heartbeat(docId, userId, partial)` (upsert + bump `lastSeen` + `publish`), `leave(docId, userId)`, `roster(docId)`. One process-wide `setInterval` TTL sweep (~10s) evicts entries older than ~15s and publishes `presence.left` (guarded on `globalThis`).
- **`lib/events.ts`** — extend the `DocEvent` union (`:13-21`) with `presence.updated` / `presence.left` / `session.started` / `session.ended`. Reuse `publish`/`subscribe` unchanged.
- **`app/api/documents/[id]/stream/route.ts`** — on connect, also send the current `roster(id)` snapshot (today it streams only future events).
- **`app/api/documents/[id]/presence/route.ts`** (new) — throttled POST beacon; `requireUser()` → participant check → `presence.heartbeat(...)`; `navigator.sendBeacon` on `pagehide` for fast leave (TTL eviction remains the source of truth).
- **`components/DocumentView.tsx`** — beacon sender + remote cursor/selection rendering via **direct DOM mutation** (reuse `applyHighlights`, `:118-125`), kept OUT of the memoized `RenderedMarkdown` subtree (`:55-57`); `startTransition` for remote updates (React 19); extend the `EventSource` switch (`:248-283`).
- **Testability:** TTL/heartbeat intervals env-tunable (like the existing `OUTBOX_POLL_MS` knob) so eviction tests don't hang.

## Phases

All five are sequential by dependency (each builds on the prior), but each is independently shippable and Playwright-testable via two logged-in browser contexts.

### P1 · Presence roster
- **Scope:** `lib/presence.ts` registry + TTL sweep; heartbeat POST route; `presence.updated`/`presence.left` events; roster snapshot on SSE connect; avatar / "N viewing" list in `DocumentView`. No cursors yet.
- **Verify:** two browser contexts → both appear in the roster; close one → eviction after TTL. Confirm a tab still holds only 2 `EventSource` connections.
- **Out of scope:** cursors, selections, sessions.
- **Depends on:** nothing (lays the foundation).

### P2 · Shared selections
- **Scope:** extend the beacon payload with the user's text selection range (reuse the offset logic in `DocumentView.tsx:96-115`); render other users' highlighted selections (extend `lib/highlight.ts`). Piggybacks on the throttled heartbeat — no new transport.
- **Out of scope:** continuous cursor tracking; session scoping.
- **Depends on:** P1.

### P3 · Live cursors
- **Scope:** add pointer position to the beacon at a tighter throttle (~5-10Hz); render floating cursor labels for other participants. Separate from P2 because selection (discrete, low-rate) and cursor (continuous) have different cadence — ship selections first to validate the transport under low rate.
- **Out of scope:** session scoping; follow-the-leader.
- **Depends on:** P1 (P2 recommended first to validate the beacon).

### P4 · Session lifecycle
- **Scope:** explicit "start a review session" with a `sessionId`, a leader, and a session-scoped participant list (distinct from ambient presence). Add `session.started`/`session.ended` events; sessions are ephemeral in-memory state on the same registry.
- **Out of scope:** persistence/history of sessions; follow-the-leader scrolling (P5).
- **Depends on:** P1.

### P5 · Follow-the-leader scroll
- **Scope:** the session leader broadcasts a throttled scroll position via the beacon; followers smooth-scroll to it. Builds directly on P4's leader concept and P3's beacon.
- **Out of scope:** shared zoom/viewport sync beyond scroll; co-editing.
- **Depends on:** P3 + P4.

## Sequence

```
P1 Presence roster        (foundation: registry + bus events + roster snapshot)
        │
        ├─ P2 Shared selections   (beacon carries selection range)
        │
        ├─ P3 Live cursors        (beacon carries cursor; P2 recommended first)
        │
        └─ P4 Session lifecycle   (leader + sessionId on the registry)
                  │
                  └─ P5 Follow-the-leader scroll   (needs P3 beacon + P4 leader)
```

## Explicitly deferred → M6+
Postgres migration & multi-instance (presence registry stays in-memory single-instance until then) · teams/org model & multi-tenancy · enforced-SSO / multiple-provider / SCIM · admin/moderator roles · soft-delete / trash / recovery · quorum / N-approver thresholds · version checkpointing/compaction · multi-hunk suggestion patches · granular per-type notification preferences · the deferred general UI-polish phase.

> **Update (M6 scoping, 2026-06-10):** _git export_ and _dedicated Slack/Teams message formatters_ have been **dropped from the backlog entirely** — not carried forward. The generic signed-webhook system remains the integration surface. See `specs/2026-06-10-quorum-ai-m6-roadmap.md`.

## Per-phase workflow
For each phase, in a fresh session on a fresh branch off the latest `main`:
1. `brainstorming` → phase design spec in `docs/superpowers/specs/`.
2. `writing-plans` → phase implementation plan + `.tasks.json` in `docs/superpowers/plans/`.
3. `executing-plans` (or `subagent-driven-development`) → implement, verify, PR.

**Worktree/env notes carried from M1–M4:** create an isolated worktree at execution time; this repo's pnpm v11 needs `CI=true` on script runs; free port 3000 before `pnpm test:e2e`; preserve existing `data-testid`/`aria-label` test hooks; rebase onto `main` (don't merge main in); pure libs → services → thin routes → client; value-sets in `lib/enums.ts`.
