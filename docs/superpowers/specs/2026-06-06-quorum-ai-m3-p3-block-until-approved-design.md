---
milestone: M3
phase: P3
slug: quorum-ai-m3-p3-block-until-approved
title: Block-until-approved long-poll
status: design-draft
created: 2026-06-06
related:
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-roadmap.md
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-p2-structured-feedback-design.md
---

# M3 / P3 — Block-Until-Approved Long-Poll

> Today an agent that pushed a plan must **re-run `/pull-feedback` by hand** to learn
> whether a decision landed. This phase lets the agent (or CI) *wait* for the
> decision with a single long-poll request, turning the loop from "poll-and-hope"
> into "block until the humans decide."

## Problem

The machine loop has no wait primitive. `/pull-feedback` reads once and, on
`decision == pending`, stops and tells the user to try again later. There's a live
event bus (`lib/events.ts`, used by SSE) but no machine-facing endpoint that exposes
it; agents can't subscribe.

## Goals

- `GET /api/plans/[id]/feedback/wait?timeoutMs=` that **holds the connection open**
  until the document's decision/state changes, then returns the P2 feedback contract;
  on timeout returns the current (`pending`) snapshot so the caller can re-arm.
- `/pull-feedback` skill gains a bounded loop that re-arms until terminal
  (`approved` / `changes_requested`).

## Non-goals (deferred to M4+)

WebSockets; server-push to laptops behind NAT (that's P4 webhooks for CI/server
contexts); waiting on sub-events finer than decision/state change.

---

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Mechanism | **Long-poll over the existing `lib/events.ts` bus.** No new transport. Subscribe to the document's events; resolve when a `review.updated` / `version.created` flips decision or state. |
| D2 | Race avoidance | **Re-check the DB state immediately on connect**, *after* subscribing, before awaiting — so a decision that landed between the client's last poll and this connect isn't missed. |
| D3 | Timeout | Client passes `timeoutMs`; server **clamps to a max** (e.g. 60 s, env-tunable) to stay under proxy/SSE-style idle limits. On expiry, return the current snapshot with a `timedOut: true` flag and HTTP 200 (not an error). |
| D4 | What counts as "changed" | A **decision transition** (pending → approved / changes_requested) **or** a new version/review while pending. The caller decides whether to stop; the skill stops on terminal decisions. |
| D5 | Auth/scope | Same owner-strict + `feedback:read` gate as `GET …/feedback` (reuse `requireApiUser` + `isOwner`). |

---

## API surface

`GET /api/plans/[id]/feedback/wait?timeoutMs=30000`

- **200** with the **P2 feedback body** plus `timedOut: boolean` once either the
  decision/state changes or the (clamped) timeout elapses.
- **404** if the token user doesn't own the plan (consistent with M2 P1).
- **403** if the token lacks `feedback:read`.

Route implementation: subscribe via `subscribe(documentId, handler)`, then DB re-check;
`await` a `Promise.race([eventFired, sleep(clampedTimeout)])`; always `unsubscribe()` in
a `finally`; build the body with the same `consolidateFeedback()` path as P2. Set
`Cache-Control: no-store`.

---

## Skill update (`.claude/commands/pull-feedback.md`)

Add an optional **wait loop**:

```
loop:
  GET …/feedback/wait?timeoutMs=30000
  if decision in {approved, changes_requested}: proceed (present P2 feedback)
  else (timedOut/pending): re-arm (respect an overall deadline / max iterations)
```

Bounded by a max iteration count so an agent never blocks forever; surface "still
pending after N waits" to the user.

---

## Testing strategy

### Unit / integration
- Connect with a pending doc, then submit an APPROVE on another path → the open request
  resolves promptly with `decision: approved`, `timedOut: false`.
- Decision that lands **between** poll and connect → caught by the on-connect DB
  re-check (resolves immediately, not after timeout).
- No change within the window → resolves at clamped timeout with `timedOut: true` and
  the current snapshot.
- `timeoutMs` above the cap is clamped; subscription is always torn down (no leak).

### E2e
- Agent token opens `/feedback/wait`; a reviewer approves in the UI; the request returns
  approved within the window.

---

## Execution notes

Independent of P1 (uses the existing event bus). Best paired with P2 for the shared
response shape. Isolated worktree; `CI=true`; rebase onto `main`.
