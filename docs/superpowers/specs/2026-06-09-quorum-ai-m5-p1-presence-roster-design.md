# Quorum AI — M5 P1: Presence Roster (Design Spec)

> **Phase:** M5 Phase 1 of 5. Foundation phase for real-time review sessions.
> **Milestone roadmap:** `docs/superpowers/specs/2026-06-09-quorum-ai-m5-roadmap.md`
> **Depends on:** nothing (lays the presence foundation P2–P5 build on).
> **Status:** Approved design — ready for `writing-plans`.

## Goal

Show, live, **who else is viewing a document right now**: an avatar stack in the
document header that updates as reviewers open and close the page. No cursors, no
selections, no sessions — those are P2–P5. This phase stands up the shared presence
foundation (in-memory registry + bus events + roster-snapshot-on-connect) that every
later M5 phase reuses.

## Non-goals (deferred to later M5 phases)

- Live cursors / continuous pointer tracking (P3)
- Shared text selections (P2)
- Session lifecycle: leader, sessionId, session-scoped participants (P4)
- Follow-the-leader scrolling (P5)
- Any persistence/history of presence — it is ephemeral, in-memory, single-instance by design.

## Hard constraints (carried from the M5 roadmap)

1. **No third `EventSource`.** Presence rides the existing
   `/api/documents/[id]/stream` SSE connection. A tab already holds 2 EventSources
   (document stream + notifications stream) against the HTTP/1.1 6-per-origin cap.
   Client→server is a throttled `POST` beacon, never a new stream.
2. **Presence state is ephemeral, in-memory, single-instance.** Hidden behind the
   `lib/presence.ts` module interface so a later Redis/Postgres-backed implementation
   can swap in when multi-instance lands (M6+). No DB tables, no schema migration.
3. **Single Next process, no new infra, zero new dependencies.**
4. **TTL/heartbeat/sweep intervals are env-tunable** (like the existing
   `OUTBOX_POLL_MS` knob) so eviction tests don't hang.

## Architecture

Four layers, following the repo's pure-libs → routes → client flow:

| Unit | File | Responsibility |
|---|---|---|
| Presence registry | `lib/presence.ts` *(new)* | In-memory `Map<docId, Map<userId, PresenceEntry>>`, `globalThis`-stashed like `lib/events.ts:23-26` (survives dev hot-reload). API: `heartbeat`, `leave`, `roster`. Owns the TTL sweep. |
| Event bus | `lib/events.ts` *(extend)* | Add `presence.sync` / `presence.updated` / `presence.left` to the `DocEvent` union. `publish`/`subscribe` unchanged. |
| Heartbeat route | `app/api/documents/[id]/presence/route.ts` *(new)* | `POST` beacon: `requireUser()` → `isParticipant()` → `presence.heartbeat()` (or `leave()` when `leaving:true`). |
| SSE route | `app/api/documents/[id]/stream/route.ts` *(extend)* | On connect, emit one `presence.sync` carrying `roster(id)` immediately after `: connected`. |
| Client container | `components/DocumentView.tsx` *(extend)* | Send heartbeats; reduce presence events into `roster` state; render the roster component. |
| Roster UI | `components/PresenceRoster.tsx` *(new)* | Presentational: overlapping initial-avatars + `+N` overflow + hover/tooltip name list. |

### Why React state, not direct DOM mutation

The roadmap's "direct DOM mutation, kept out of the memoized `RenderedMarkdown`
subtree" guidance applies **only** to cursors/selections (P2/P3), which must inject
markers into the markdown body without re-reconciling that memoized subtree. The
P1 roster is a **header element outside** that subtree, so ordinary React `useState`
is correct and simpler. No hand-mutated DOM in this phase.

## Data shapes

```ts
// lib/presence.ts
export interface PresenceEntry {
  userId: string;
  name: string;
  lastSeen: number; // epoch ms
}
// P1 deliberately omits cursor / selection / sessionRole. The entry stays
// forward-compatible: P2–P4 add optional fields without breaking P1 consumers.

// lib/events.ts — additions to the DocEvent union
| { type: "presence.sync"; roster: PresenceEntry[] }   // full snapshot, sent once on connect
| { type: "presence.updated"; entry: PresenceEntry }   // single-entry upsert delta
| { type: "presence.left"; userId: string }            // single-entry removal delta
```

`presence.sync` is a justified extension beyond the roadmap's listed
`presence.updated`/`presence.left`: it cleanly separates the connect-time snapshot
(replace whole roster) from incremental deltas (upsert / drop one entry), keeping the
client reducer trivial and unambiguous about "snapshot complete".

## `lib/presence.ts` API

```ts
heartbeat(docId: string, entry: { userId: string; name: string }): void
  // upsert into the doc's map, set lastSeen = now, publish presence.updated

leave(docId: string, userId: string): void
  // delete the entry; publish presence.left (no-op if absent)

roster(docId: string): PresenceEntry[]
  // current entries for the doc (empty array if none)
```

- Module-level singleton stashed on `globalThis` (mirrors `lib/events.ts:23-26`) so
  dev hot-reload reuses one registry.
- **One** process-wide sweep `setInterval` (guarded on `globalThis` so hot-reload
  doesn't spawn duplicates) runs every `PRESENCE_SWEEP_MS` (~10s), evicting entries
  with `now - lastSeen > PRESENCE_TTL_MS` (~15s) and publishing `presence.left` for
  each evicted entry.
- Env knobs (with defaults): `PRESENCE_TTL_MS` (15000), `PRESENCE_SWEEP_MS` (10000).
  Client heartbeat cadence: `NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS` (10000) — must be
  comfortably below the TTL.

## Data flow

1. Client mounts `DocumentView` → existing SSE (`/stream`) connects → server sends
   `: connected` then `presence.sync` (the current roster).
2. Client **optimistically seeds itself** into local roster state from the new
   `currentUserId` / `currentUserName` props, so its own `(you)` avatar shows instantly
   without waiting for the heartbeat echo.
3. Client `POST /presence` immediately on mount, then every
   `NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS`.
4. `heartbeat()` upserts the entry + bumps `lastSeen` + `publish`es `presence.updated`,
   which fans out to all SSE subscribers (including the sender, reconciling the optimistic seed).
5. On `pagehide`, client calls `navigator.sendBeacon('/api/documents/[id]/presence',
   { leaving: true })` for fast departure → `leave()` → `presence.left`. TTL eviction
   remains the source of truth if the beacon never arrives.
6. The sweep interval evicts stale entries and publishes `presence.left`.

## Client reducer

Pure reduction over the incoming presence events, keyed by `userId`:

- `presence.sync` → **replace** the whole roster with `roster`.
- `presence.updated` → **upsert** `entry` by `userId`.
- `presence.left` → **remove** the entry with that `userId`.

Because the registry and the client roster are both keyed by `userId`, a single user
with multiple open tabs collapses to one roster entry (later heartbeats just refresh
`lastSeen`).

## Roster UI (`components/PresenceRoster.tsx`)

- Props: `roster: PresenceEntry[]`, `currentUserId: string`.
- Renders in the `DocumentView` header, next to the title (before `Edit`/`History`).
- Overlapping circular avatars showing **initials** derived from `name` (fallback to
  email-local-part if name is blank), with a deterministic background color hashed
  from `userId`.
- Caps the visible avatars (e.g. 3–4) and shows a `+N` overflow chip.
- Hover/focus → tooltip or small popover listing all present users by name; the
  current user is labelled `(you)`.
- Count reflects everyone present **including self** (e.g. "3 viewing" = you + 2).
- Accessibility: stack has an `aria-label` like `"3 people viewing"`; a stable
  `data-testid="presence-roster"` for Playwright. Individual avatars carry the user's
  name (e.g. `title`/`aria-label`) so the E2E test can assert specific participants.

## Heartbeat route (`app/api/documents/[id]/presence/route.ts`)

`POST` only. Mirrors the auth pattern of the annotations route:

1. `requireUser()` → 401 if absent.
2. `isParticipant(user.id, id)` → 404 if not a participant (don't leak existence).
3. Parse body: `{ leaving?: boolean }`. If `leaving === true` → `presence.leave(id, user.id)`.
   Otherwise → `presence.heartbeat(id, { userId: user.id, name: user.name })`.
4. Return `204 No Content` (beacon responses are ignored client-side).

The user's identity (`id`, `name`) comes from the server session via `requireUser()`;
the client never sends its own identity in the payload.

## SSE route change (`app/api/documents/[id]/stream/route.ts`)

In the stream's `start(controller)`, after enqueuing `: connected` and subscribing,
also enqueue one `presence.sync` event built from `roster(id)`. No other change; the
existing event fan-out already carries `presence.updated`/`presence.left` because they
go through the same `publish`/`subscribe` bus.

## Passing identity to the client

`DocumentView` currently receives no current-user identity. The document page
(server component that renders `DocumentView`) already resolves the session; it will
pass `currentUserId` and `currentUserName` props so the client can (a) seed its own
optimistic entry and (b) mark `(you)` in the roster.

## Error handling & edge cases

- Heartbeat `fetch` failures are swallowed (`.catch(() => {})`, same as `markRead` in
  `NotificationProvider`); the next interval retries; TTL self-heals a missed beat.
- `sendBeacon` unsupported or failing → TTL eviction removes the entry within ~15s.
- SSE reconnect (existing `onerror` → retry path) re-runs `connect()`; the server
  resends `presence.sync` on the new connection, so the roster re-syncs automatically.
- Non-participant / unauthenticated POST → 404 / 401, no presence side effect.
- A user with multiple tabs is one roster entry (keyed by `userId`); closing one tab
  fires a `leaving` beacon but the entry stays alive while other tabs keep
  heartbeating (their heartbeats re-add it; net effect is correct because eviction is
  `lastSeen`-based).

## Testing

**Unit (`e2e/unit`, Vitest):**
- `lib/presence.ts`: heartbeat upsert + `lastSeen` bump; `roster()` dedupe by userId;
  `leave()` removal; TTL sweep evicts stale entries and publishes `presence.left`
  (drive with small env-tuned intervals / injectable clock so the test never hangs).
- Client presence reducer: pure-function tests for `sync` / `updated` / `left`.

**E2E (Playwright, two logged-in browser contexts on one document):**
- Both contexts open the same doc → each sees the other's avatar in
  `[data-testid="presence-roster"]`; since self is included, each context shows a
  count of 2 (itself + the other) and both participants' names appear in the list.
- Close one context → its avatar disappears from the other's roster after TTL.
- Assert the tab holds exactly **2** `EventSource` connections (no third stream).
- Preserve existing `data-testid` / `aria-label` test hooks.

**Gates before PR:** `pnpm test:unit`, `pnpm test:e2e`, `pnpm lint` all green.

## File summary

| Action | Path |
|---|---|
| Create | `lib/presence.ts` |
| Create | `app/api/documents/[id]/presence/route.ts` |
| Create | `components/PresenceRoster.tsx` |
| Extend | `lib/events.ts` (DocEvent union) |
| Extend | `app/api/documents/[id]/stream/route.ts` (presence.sync on connect) |
| Extend | `components/DocumentView.tsx` (heartbeat sender, reducer, render roster) |
| Extend | document page server component (pass `currentUserId`/`currentUserName`) |
| Tests | `e2e/unit/presence.test.ts` (+ reducer test); Playwright presence spec |
