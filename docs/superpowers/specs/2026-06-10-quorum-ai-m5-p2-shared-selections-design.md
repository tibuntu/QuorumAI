# Quorum AI — M5 P2: Shared Selections (Design Spec)

> **Phase:** M5 Phase 2 of 5.
> **Milestone roadmap:** `docs/superpowers/specs/2026-06-09-quorum-ai-m5-roadmap.md`
> **Depends on:** P1 (presence registry, beacon route, SSE presence events, roster UI) — shipped.
> **Status:** Approved design — ready for `writing-plans`.

## Goal

While reviewing a document together, each participant sees **what text the others
have selected**, live: a translucent band in the other user's avatar color over the
selected range, with the user's name on hover. Selections piggyback on the existing
P1 presence beacon and SSE fan-out — no new transport, no new EventSource.

## Decisions made during brainstorming

1. **Cadence — throttled immediate.** Selection changes fire the existing beacon
   right away through a leading+trailing throttle (`NEXT_PUBLIC_PRESENCE_SELECTION_THROTTLE_MS`,
   default 250ms ≈ 4Hz, inside the roadmap's ~5Hz budget). The 10s keep-alive
   heartbeat continues unchanged.
2. **Version drift — tag with version.** Offsets are only meaningful against the
   markdown they were measured on, so each selection carries the sender's
   `versionNumber`; clients render only selections matching their own version.
   Stale selections silently disappear instead of mis-highlighting.
3. **Visuals — tinted band + name on hover.** Per-user deterministic color (same
   hash as the roster avatars), translucent background, user's name in the mark's
   `title`. No floating name chips (that's P3 cursor-label territory). Own
   selection keeps the native browser look; annotation highlights stay yellow/orange.
4. **Rendering — separate presence layer (Approach A).** New
   `applyPresenceSelections`/`clearPresenceSelections` in `lib/highlight.ts`
   operate exclusively on `mark[data-presence-user-id]`, sharing a parameterized
   `wrapRange` with the annotation layer. The two layers never clear each other's
   marks, so 4Hz selection churn cannot thrash annotation highlights.

## Non-goals (deferred)

- Continuous cursor/pointer tracking and floating cursor labels (P3).
- Session scoping, leader/follower semantics (P4/P5).
- Re-anchoring selections across versions (annotation-grade `lib/anchoring`
  relocation is overkill for seconds-lived ephemeral state).
- Any persistence of selections.

## Hard constraints (carried from the M5 roadmap)

1. No third `EventSource` — selections ride the existing beacon POST and
   `/api/documents/[id]/stream` SSE.
2. Ephemeral, in-memory, single-instance, behind the `lib/presence.ts` interface.
3. Zero new dependencies, single Next process.
4. Intervals env-tunable; preserve existing `data-testid`/`aria-label` hooks.

## Data shapes (`lib/events.ts`)

```ts
export interface PresenceSelection {
  start: number;         // offset into the rendered container's textContent
  end: number;           // exclusive; start < end
  versionNumber: number; // document version the offsets were measured against
}

export interface PresenceEntry {
  userId: string;
  name: string;
  lastSeen: number;
  selection?: PresenceSelection; // NEW — absent when nothing selected
}
```

**No new `DocEvent` types.** `presence.updated` already carries the full entry and
`presence.sync` the full roster, so selections fan out through the existing P1
events unchanged.

## Registry (`lib/presence.ts`)

`heartbeat(documentId, user, selection?: PresenceSelection | null)` — third
argument added. Every heartbeat states the **full selection truth**: a
`PresenceSelection` sets `entry.selection`, `null`/`undefined` clears it. The
client owns its selection state, so there is no server-side merge ambiguity, and
the 10s keep-alive cannot wipe a live selection because all senders share one
ref (see send path). `leave`/`roster`/TTL sweep unchanged.

## Beacon contract (`app/api/documents/[id]/presence/route.ts`)

Body becomes:

```ts
{ leaving?: boolean; selection?: { start: number; end: number; versionNumber: number } | null }
```

- `leaving: true` → `leave()` (unchanged).
- Otherwise validate `selection` when present and non-null: all three fields
  integers, `0 <= start < end`, `versionNumber >= 1` → else **400** with no
  presence side effect. (`sendBeacon` ignores responses; the 400 exists for tests
  and API hygiene.)
- Valid → `heartbeat(id, { userId, name }, selection ?? null)` → 204.
- Identity stays server-derived from `requireUser()`; participant check unchanged.

## Client send path (`components/DocumentView.tsx`)

- A `selectionRef: { current: PresenceSelection | null }` holds the user's current
  selection.
- The existing `selectionchange` handler (offset logic at `:102-121`) additionally
  maintains the ref:
  - valid non-collapsed selection inside the container →
    `{ start, end, versionNumber }` (the component's current `versionNumber` state);
  - collapsed or outside-container selection → `null` — a case the current handler
    early-returns on. The `PendingSelection` comment-composer behavior is untouched
    (it still keeps the last selection so the composer stays open).
- One `sendPresence()` posts `{ selection: selectionRef.current }` and serves all
  three triggers: mount, the 10s heartbeat interval, and selection changes.
- Selection changes invoke it through a leading+trailing throttle
  (`NEXT_PUBLIC_PRESENCE_SELECTION_THROTTLE_MS`, default 250). Trailing edge
  guarantees the final selection state is always sent.
- The `pagehide` leave beacon is unchanged.

## Render path

| Unit | File | Responsibility |
|---|---|---|
| Selection filter | `lib/presence-client.ts` *(extend)* | Pure `remoteSelections(roster, selfId, versionNumber)` → `{ userId, name, start, end }[]`, dropping self, entries without selections, and version-mismatched selections. Node-unit-testable. |
| Color palette | `lib/presence-roster.ts` *(extend)* | `SELECTION_COLORS` — translucent counterparts of `AVATAR_COLORS`, indexed by the same hash → `selectionColorFor(userId)`. A user's selection tint always matches their avatar color. |
| DOM layer | `lib/highlight.ts` *(extend)* | `wrapRange` parameterized with a mark factory. New `applyPresenceSelections(container, sels)` / `clearPresenceSelections(container)` operating **exclusively** on `mark[data-presence-user-id]`. Marks carry `data-presence-user-id`, `data-user-name` (test hook), `title` = name (hover), class from `selectionColorFor`. |
| Driver | `components/DocumentView.tsx` *(extend)* | New `useEffect` on `[roster, versionNumber, markdown, mode]`: review mode → `applyPresenceSelections(container, remoteSelections(...))`; edit mode / cleanup → `clearPresenceSelections`. Independent of the annotation-highlight effect. |

Remote marks are direct DOM mutation outside React's render (the memoized
`RenderedMarkdown` subtree is never reconciled after mount), exactly like the
annotation highlight layer.

**Layer interplay:** wrapping text in `<mark>` does not change `textContent`
length, so both layers' offsets stay valid regardless of application order. A
range that would cross the other layer's mark boundary (or any element boundary)
is skipped — the same single-text-node MVP fallback the annotation layer already
uses.

## Error handling & edge cases

- **Stale version:** filtered client-side by `remoteSelections`; when a new
  version is saved, `markdown` re-renders the subtree and both layers re-apply
  against fresh DOM; remote selections from the old version vanish.
- **Departure:** `presence.left` (beacon or TTL eviction) shrinks the roster →
  the driver effect re-runs → that user's marks are cleared.
- **Self:** never rendered as a remote selection.
- **Multiple tabs, one user:** one registry entry → last-writer-wins selection
  (consistent with P1's keyed-by-userId model).
- **Cross-boundary ranges:** skipped (existing fallback); the roster still shows
  the user as present.
- **Malformed beacon:** 400, no side effect. Beacon `fetch` failures swallowed;
  next throttle tick or heartbeat retries.
- **Edit mode:** remote selections cleared while editing; reappear on return to
  review mode (effect re-runs on `mode`).

## Testing

**Unit (Vitest, node env — pure helpers only, like P1):**
- `lib/presence.ts`: `heartbeat` with selection sets it; with `null`/absent clears
  it; selection survives `lastSeen` bumps only when re-sent.
- Presence route: validation matrix — valid selection 204 + stored; `start >= end`,
  negative, non-integer, missing `versionNumber` → 400, registry untouched.
- `remoteSelections`: drops self, no-selection entries, version mismatches; passes
  matching ones with name/color inputs intact.
- `selectionColorFor`: deterministic, aligned with `colorFor` hash.

**E2E (Playwright, two logged-in contexts on one document, extends the
`presence.spec.ts` pattern):**
- B selects text → A sees `mark[data-presence-user-id]` whose `data-user-name`
  contains "Grace" and whose `title` is the name; selected text content matches.
- B collapses the selection → the mark disappears from A's view.
- Annotation highlight (`mark[data-annotation-id]`) and a remote selection coexist
  on the same document without clearing each other.
- Existing P1 assertions (roster, 2-EventSource cap) keep passing.

**Gates before PR:** `pnpm test:unit`, `pnpm test:e2e`, `pnpm lint` all green.

## File summary

| Action | Path |
|---|---|
| Extend | `lib/events.ts` (`PresenceSelection`, `PresenceEntry.selection`) |
| Extend | `lib/presence.ts` (`heartbeat` third arg, store/clear selection) |
| Extend | `app/api/documents/[id]/presence/route.ts` (parse + validate selection) |
| Extend | `lib/presence-client.ts` (`remoteSelections`) |
| Extend | `lib/presence-roster.ts` (`SELECTION_COLORS`, `selectionColorFor`) |
| Extend | `lib/highlight.ts` (mark-factory `wrapRange`, `applyPresenceSelections`, `clearPresenceSelections`) |
| Extend | `components/DocumentView.tsx` (selection ref + throttled send; presence-selection effect) |
| Tests | `tests/unit/` additions; `tests/e2e/presence.spec.ts` (or sibling spec) |
