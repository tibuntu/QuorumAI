# Quorum AI — M5 P5: Follow-the-Leader Scroll (Design Spec)

> **Phase:** M5 Phase 5 of 5 (final phase of the "Real-Time Review Sessions" milestone).
> **Milestone roadmap:** `docs/superpowers/specs/2026-06-09-quorum-ai-m5-roadmap.md` → P5.
> **Depends on:** P3 (live cursors — the normalized-coordinate beacon) and P4 (session lifecycle — the leader concept). Both shipped on `main`.
> **Status:** Approved design — ready for `writing-plans`.

## Goal

While a review session is active, the session **leader's vertical scroll position
broadcasts to followers**, who smooth-scroll to match — so a leader can walk a team
through a document and everyone's viewport stays together. Followers **auto-follow on
join**; a **manual scroll detaches** them, with a one-click **"Resume"** to re-attach.

This builds directly on P4's leader (`lib/review-session.ts`) and P3's beacon
(`/api/documents/[id]/presence` + normalized coordinates). **No new transport, no new
`DocEvent`, no third `EventSource`** — leader scroll rides the existing presence beacon
and `presence.updated` fan-out exactly as cursors do.

## Decisions made during brainstorming

1. **Follow model — auto-follow on join; manual scroll detaches; "Resume" re-attaches.**
   A non-leader participant follows by default the moment they join. If they scroll
   manually they detach (so nobody is scroll-hijacked against their will); a "Jump back
   to {leader} · Resume" affordance re-attaches and jumps to the leader's current
   position. (Rejected: a hard always-snap follow — coercive, fights manual scroll; an
   explicit off-by-default toggle — costs a click before delivering the core value.)
2. **Transport — the P3 presence beacon, leader-gated.** Add a normalized `scroll`
   field to `PresenceEntry`, sent on the existing throttled beacon **only while you are
   the session leader**, fanned out via the existing `presence.updated` /
   `presence.sync` events. Zero new transport, zero new event types, zero new
   `EventSource`. (Rejected: a new `session.scroll` event / `ReviewSession` field — adds
   an event type and a second send path for no benefit, since scroll is ephemeral
   awareness just like a cursor.)
3. **No follower-count readout.** The leader broadcasts scroll; there is no "N
   following" indicator. Keeps P5 minimal and matches the milestone's ephemeral-awareness
   ethos. (A follower count would require followers to report follow-state back up — an
   extra beacon field + fan-out — expanding scope beyond pure follow-the-leader scroll.)

## Non-goals (deferred)

- Horizontal scroll, zoom, or viewport-size sync (vertical scroll only).
- Leadership transfer (P4 auto-ends the session if the leader drops; no hand-off).
- A follower-count / "who is following" readout shown to the leader.
- Persistence or history of scroll positions.
- Re-anchoring across reflow/versions — the normalized model's accepted vertical drift
  (inherited from the P3 cursor model) stands.

## Hard constraints (carried from the M5 roadmap)

1. **No third `EventSource`** — leader scroll rides the existing beacon POST and
   `/api/documents/[id]/stream` SSE. A tab still holds exactly **2** EventSource
   connections (document + notifications).
2. Ephemeral, in-memory, single-instance, behind the `lib/presence.ts` interface.
3. Zero new dependencies, single Next process.
4. Intervals/throttles env-tunable; preserve existing `data-testid`/`aria-label` hooks.

## Coordinate model (mirrors P3 cursors)

In review mode the document scrolls via the **window** — the doc-body container
(`[data-testid="doc-body"]`) grows tall and the page scrolls; there is no inner scroll
container, and the sidebar is `sticky`. So "scroll position" is encoded as a single
**vertical fraction of the doc-body box**, in the same spirit as the P3 cursor `y`:

- **Leader encodes** its viewport-top relative to the doc body:
  `frac = clamp01(-rect.top / rect.height)`, where
  `rect = container.getBoundingClientRect()`. `rect.top` is the doc-body top relative to
  the viewport top, so `-rect.top` is how far the viewport top has moved into the doc
  body. `frac = 0` when the doc-body top is at the viewport top; `frac = 0.5` when the
  viewport top sits halfway down the doc body.
- **Follower decodes** by scrolling so the same fraction sits at its viewport top:
  `target = scrollY + rect.top + frac * rect.height`, then
  `window.scrollTo({ top: target, behavior: "smooth" })`.

This is reflow-tolerant in exactly the way P3 accepts: if two reviewers' window widths
reflow the markdown to different heights, vertical position drifts slightly. Acceptable
for ephemeral awareness. The fraction arithmetic is a **pure, unit-tested helper**
(`scrollTargetTop`); only the `getBoundingClientRect()` read lives in the component.

Guards: skip when `rect.height === 0` (matches the P3 cursor guard) and clamp the
fraction to `[0,1]`.

## Data shapes (`lib/events.ts`)

```ts
export interface PresenceScroll {
  y: number; // 0..1 fraction of the doc-body box height (viewport-top position)
}

export interface PresenceEntry {
  userId: string;
  name: string;
  lastSeen: number;
  selection?: PresenceSelection; // P2
  cursor?: PresenceCursor;       // P3
  scroll?: PresenceScroll;       // NEW — present only while this user is a session leader broadcasting scroll
}
```

**No new `DocEvent` type.** `presence.updated` already carries the full entry and
`presence.sync` the full roster, so scroll fans out through the existing P1/P2/P3 events
unchanged. A late joiner gets the leader's current scroll in the connect-time
`presence.sync` snapshot.

## Registry (`lib/presence.ts`)

`heartbeat(documentId, user, selection?, cursor?, scroll?)` — a 5th positional
argument, consistent with how P3 added `cursor` as the 4th. Same **full-truth**
semantics every heartbeat already uses: an object sets `entry.scroll`,
`null`/`undefined` clears it (the client owns its scroll state). `leave` / `roster` /
TTL sweep unchanged.

## Beacon contract (`app/api/documents/[id]/presence/route.ts`)

Body becomes:

```ts
{
  leaving?: boolean;
  selection?: { start: number; end: number; versionNumber: number } | null; // P2
  cursor?: { x: number; y: number } | null;                                 // P3
  scroll?: { y: number } | null;                                            // NEW
}
```

- New `parseScroll`, mirroring P3's `parseCursor`: `null`/absent → no scroll;
  otherwise `y` must be a **finite number in `[0,1]`** → else **400** with no presence
  side effect. (`sendBeacon`/`fetch` ignore the body; the 400 exists for tests and API
  hygiene.)
- Valid → `heartbeat(id, { userId, name }, selection, cursor, scroll)` → 204.
- Identity stays server-derived from `requireUser()`; participant check unchanged.
- **No server-side leadership check.** The server stores `scroll` on whoever sends it,
  but the client only *sends* scroll while `isLeader(session, me)`, and followers only
  ever *read* the session leader's entry (see `leaderScroll` below) — so a non-leader's
  stray `scroll` is inert. This deliberately keeps the presence route decoupled from the
  session registry (`lib/review-session.ts`); the two registries stay independent, as in
  P4.

## Client — send path (`components/DocumentView.tsx`, leader only)

- A `scrollRef: { current: PresenceScroll | null }` holds the leader's current
  viewport-top fraction.
- A **`window` `scroll` listener**, active only in review mode **and** when
  `isLeader(session, currentUserId)`, computes `frac` from the doc-body
  `getBoundingClientRect()` (skipping `rect.height === 0`), writes `scrollRef.current =
  { y: frac }`, and queues a send through a **separate scroll throttle**
  (`NEXT_PUBLIC_PRESENCE_SCROLL_THROTTLE_MS`, default `100` ≈ 10Hz; leading+trailing like
  the P3 cursor throttle so the final position always lands). This throttle is distinct
  from the P2 selection (250ms) and P3 cursor (100ms) throttles so the cadences never
  entangle.
- When the user is **not** the leader, has no session, or is in edit mode, `scrollRef`
  stays `null` so the beacon omits scroll. On the **transition** out of leading (session
  ends, leader leaves, or edit mode) it sets `scrollRef.current = null` and sends once
  (same one-shot-clear guard pattern as the P3 cursor `mouseleave` / `clearShared`), so a
  former leader's scroll doesn't linger in their entry.
- `sendPresence()` now posts `{ selection: selectionRef.current, cursor:
  cursorRef.current, scroll: scrollRef.current }`. Mount, the 10s heartbeat, and the
  selection/cursor/scroll throttles all funnel through this single POST, each stating the
  full truth of all three refs.

## Client — follow path (`components/DocumentView.tsx`, follower)

- New pure module **`lib/follow-client.ts`** (no React, unit-tested):
  - `leaderScroll(roster: PresenceEntry[], session: ReviewSession | null, selfId: string): number | null`
    — returns the session leader's `scroll.y` **iff** there is an active session,
    `selfId` is a participant, and `selfId !== leaderId`, and the leader's roster entry
    has a `scroll`; otherwise `null`. (So the leader following itself, non-participants,
    and the no-session case all return `null`.)
  - `scrollTargetTop(scrollY: number, rectTop: number, rectHeight: number, frac: number): number`
    — `scrollY + rectTop + frac * rectHeight` (the decode arithmetic), pure.
- Component state `attached: boolean`, **defaults `true` on joining a session** (set
  when the local user becomes a participant; reset to `true` on each fresh join).
- When `attached` and the value of `leaderScroll(...)` changes, the component
  programmatically `window.scrollTo({ top: scrollTargetTop(...), behavior: "smooth" })`.
  This is wrapped in a **`programmaticScroll` guard** (a ref set `true` immediately
  before the scroll, cleared on `scrollend` or after a short timeout fallback) so the
  resulting `scroll` events are not mistaken for a manual scroll.
- **Detach:** a `window` `scroll` event that is **not** programmatic sets
  `attached = false`.
- **Resume:** the banner's "Resume" button sets `attached = true` and immediately jumps
  to the leader's current `leaderScroll(...)` position.
- When the session ends / the local user leaves / loses participant status,
  `attached` resets and the follow UI clears (driven by `session`/`roster` state, so it
  needs no extra teardown).

## UI (`components/SessionBanner.tsx`)

Two new props, surfaced **only to a non-leader participant** (`joined && !leader`):

```ts
followAttached: boolean;
onResumeFollow: () => void;
```

| Viewer | Added UI | Hooks |
| --- | --- | --- |
| Non-leader participant, attached | `Following {leaderName}` indicator | `following-indicator` |
| Non-leader participant, detached | `Jump back to {leaderName} · Resume` button | `resume-following` |

The leader's banner and the not-yet-joined banner are unchanged (no follower count, per
the minimal-scope decision). `DocumentView` passes `followAttached={attached}` and
`onResumeFollow={resumeFollow}` alongside the existing `SessionBanner` props.

## Error handling & edge cases

- **Tiny / unscrollable document:** `frac ≈ 0`; `scrollTo(top: ~0)` is a no-op. Harmless.
- **Programmatic-scroll feedback loop:** the `programmaticScroll` guard prevents a
  follower's auto-scroll from detaching itself.
- **Leader switches to edit mode:** scroll tracking is review-mode only (like cursor /
  selection); `scrollRef` clears and the one-shot clear send fires.
- **Leader drops / session auto-ends (P4 sweep):** `session` becomes `null` →
  `leaderScroll` returns `null`, follow UI clears, `attached` resets. The ex-leader's
  `scroll` (if any) is inert with no session.
- **New joiner mid-session:** auto-attached; the connect-time `presence.sync` carries the
  leader's current `scroll`, so the first `leaderScroll` change jumps them into place.
- **Multiple tabs, one user as leader:** one registry entry → last-writer-wins scroll
  (consistent with the P1 keyed-by-userId model).
- **Malformed beacon:** 400, no side effect; the next throttle tick or 10s heartbeat
  retries. Beacon `fetch` failures swallowed.
- **Coexistence:** scroll rides the same entry as cursor + selection; none clears another.

## Testing

**Unit (Vitest, node env — pure helpers and the route, like P1/P2/P3):**
- `lib/presence.ts`: `heartbeat` with a `scroll` stores it; `null`/absent clears it;
  scroll coexists with cursor and selection on one entry.
- Presence route: `parseScroll` matrix — valid `{y}` in `[0,1]` → 204 + stored; `y` out
  of `[0,1]`, non-finite (NaN/Infinity), non-number, or a missing `y` → 400, registry
  untouched. Existing selection/cursor validation tests keep passing.
- `lib/follow-client.ts`: `leaderScroll` returns the leader's scroll only for a
  non-leader participant in an active session (and `null` for leader-self, non-participant,
  no session, leader-without-scroll); `scrollTargetTop` arithmetic.

**E2E (`tests/e2e/follow.spec.ts`, two logged-in contexts on one document, mirroring the
`sessions.spec.ts` / `cursors.spec.ts` setup):**
- A starts a session (leader); B joins → B sees `following-indicator`.
- A scrolls the window down → B's `window.scrollY` tracks toward A's position within a
  generous timeout (assert via `page.evaluate(() => window.scrollY)`).
- B scrolls manually → `resume-following` appears; further A-scrolling no longer moves B.
- B clicks `resume-following` → re-attaches and jumps to A's current position.
- A ends the session → B's follow UI clears.
- A's tab still holds exactly **2** EventSource connections (reuse the
  `countEventSources` init-script helper from `presence.spec.ts`).

**Gates before PR:** `pnpm test:unit`, `pnpm test:e2e`, `pnpm lint` all green.

## File summary

| Action | Path |
|---|---|
| Extend | `lib/events.ts` (`PresenceScroll`, `PresenceEntry.scroll`) |
| Extend | `lib/presence.ts` (`heartbeat` 5th arg, store/clear scroll) |
| Extend | `app/api/documents/[id]/presence/route.ts` (`parseScroll` + validate) |
| New | `lib/follow-client.ts` (`leaderScroll`, `scrollTargetTop`) |
| Extend | `components/SessionBanner.tsx` (`followAttached` + `onResumeFollow` UI) |
| Extend | `components/DocumentView.tsx` (leader scroll send; follower attach/detach/resume; pass banner props) |
| Tests | `tests/unit/` additions; `tests/e2e/follow.spec.ts` *(new)* |

## Worktree/env notes (carried from M1–M4)

Isolated worktree at execution time · `CI=true` on pnpm script runs · free port 3000
before `pnpm test:e2e` · preserve existing `data-testid`/`aria-label` hooks · pure libs →
services → thin routes → client · value-sets in `lib/enums.ts` · rebase onto `main`,
don't merge · new env knob `NEXT_PUBLIC_PRESENCE_SCROLL_THROTTLE_MS` (default 100).
