---
milestone: M3
phase: P1
slug: quorum-ai-m3-p1-foundations-outbox
title: Foundations & durable outbox
status: design-approved
created: 2026-06-06
related:
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-roadmap.md
  - docs/superpowers/specs/2026-06-06-quorum-ai-m2-p2-email-design.md
---

# M3 / P1 — Foundations & Durable Outbox

> Foundation phase of M3. Reliable outbound delivery (P4 webhooks) and durable
> batched email need state that survives a process restart and a single worker
> draining it with retry/backoff. Today `lib/email-digest.ts` (a `Map` of
> `setTimeout`s) and `lib/events.ts` (an in-process `EventEmitter`) are
> single-process and lost on restart — fine for live UI, not for delivery
> guarantees. This phase adds a durable `OutboxJob` queue + worker, moves email
> onto it, and folds in two cheap enablers: missing FK indexes and the
> `Annotation.severity`/`category` fields that P2 filters on.

## Problem

- **No durable async work.** `lib/email-digest.ts` coalesces events in an in-memory
  `Map<userId:documentId, Buffer>` with a 45 s debounce timer; a restart drops every
  pending digest silently. P4 webhooks would inherit the same fragility.
- **Missing FK indexes** (known follow-up, STATUS.md): `Annotation.authorId`,
  `Comment.authorId`, `Review.reviewerId`, `DocumentVersion.createdById`.
- **No place to record severity/category** on feedback — P2's structured contract and
  filtering need it on `Annotation`.

## Goals

- A durable `OutboxJob` table + a single in-process polling worker with
  status / attempts / backoff / dead-letter, started at server bootstrap.
- Email digest flush re-homed onto the outbox (same 45 s coalescing behaviour,
  now restart-safe).
- FK indexes added; `Annotation.severity` + `Annotation.category` added (nullable).

## Non-goals (deferred to M4+)

Distributed / multi-worker queues; external brokers (Redis / BullMQ); Postgres; SSE
durability (it is inherently live/ephemeral and stays in-memory). Single-instance
SQLite is the explicit operating assumption.

---

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Queue substrate | **DB-backed `OutboxJob` table in SQLite.** No new infra; survives restart; one writer fits the single-instance model. |
| D2 | Worker model | **One in-process polling worker** started once at server bootstrap (module singleton guard, like `lib/events.ts`'s `globalThis` pattern). Polls `nextAttemptAt <= now`, leases a row to `DELIVERING`, runs the handler, marks `DONE`/re-schedules/`DEAD`. |
| D2a | **Worker boot location** (resolved) | **`instrumentation.ts`** (`register()` hook — stable in Next 16). Fires once at server start, never during `next build`. Guarded `process.env.NEXT_RUNTIME === "nodejs"` (never edge) and **auto-start is env-gated off under test** — `startOutboxWorker()` no-ops unless `OUTBOX_WORKER_AUTOSTART` is truthy and `NODE_ENV !== "test"`, so vitest drives the worker deterministically via an exported `tick()`. |
| D5a | **Backoff schedule** (resolved) | **Explicit delay table** `1m, 5m, 30m, 2h, 6h` via a pure `computeBackoffMs(attempts)`; `maxAttempts=6` (5 retries → DEAD, ~8h40m reach). **No jitter** (single serial worker). Both table (`OUTBOX_BACKOFF_MS`, comma-separated) and `OUTBOX_MAX_ATTEMPTS` are env-tunable. |
| D3 | Email's relationship to the outbox | **Email digest becomes an `OutboxJob` of type `email.digest`.** Debounce stays in a thin in-memory coalescer that, on window close, enqueues one durable job — so a crash mid-window at worst loses ≤45 s of *coalescing*, never an already-scheduled send. |
| D4 | Handler registry | **Typed handler map** keyed by `OutboxJob.type` (`email.digest`, later `webhook.deliver`). Unknown type → `DEAD` (no silent drop). |
| D5 | Backoff | **Explicit delay table with cap** — 1m, 5m, 30m, 2h, 6h; `maxAttempts` then `DEAD`. Tunable via env. (Schedule values resolved in D5a.) |

---

## Data model & migration

### Schema (`prisma/schema.prisma`)

```prisma
model OutboxJob {
  id            String   @id @default(cuid())
  type          String                       // "email.digest" | "webhook.deliver"
  payload       String                       // JSON string (SQLite has no native JSON)
  status        String   @default("PENDING") // PENDING | DELIVERING | DONE | DEAD
  attempts      Int      @default(0)
  maxAttempts   Int      @default(6)
  nextAttemptAt DateTime @default(now())
  lastError     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([status, nextAttemptAt])
}
```

Plus the deferred FK indexes (add `@@index` on `Annotation.authorId`,
`Comment.authorId`, `Review.reviewerId`, `DocumentVersion.createdById`) and on
`Annotation`:

```prisma
  severity String?   // BLOCKER | MAJOR | MINOR | NIT  (nullable; see lib/enums.ts)
  category String?   // free-form short tag, e.g. "security", "scope", "naming"
```

`SEVERITIES` added to `lib/enums.ts` alongside the existing value-sets.

### Migration

Pure additive — new table, new nullable columns, new indexes. No backfill needed
(severity/category default null; existing email path swaps to the outbox at deploy).

---

## Library surface

```ts
// lib/outbox.ts
enqueue(type: string, payload: unknown, opts?: { delayMs?: number }): Promise<string>
registerHandler(type: string, fn: (payload: unknown) => Promise<void>): void
startOutboxWorker(): void   // idempotent; guarded via globalThis like lib/events.ts.
                            // No-ops unless OUTBOX_WORKER_AUTOSTART is truthy and NODE_ENV !== "test".
tick(): Promise<void>       // process all currently-due jobs once; exported for deterministic tests
computeBackoffMs(attempts: number): number  // pure; reads OUTBOX_BACKOFF_MS table, clamps to last entry
```

`lib/email-digest.ts` keeps its `enqueueEmailEvent(...)` public API (callers in
`lib/notifications.ts` unchanged) but, on debounce-window close, calls
`enqueue("email.digest", { userId, documentId, events })` instead of sending inline.
The `email.digest` handler renders + sends via the existing `lib/email.ts`.

Worker bootstrap: a root `instrumentation.ts` whose `register()` calls
`startOutboxWorker()` once, guarded `process.env.NEXT_RUNTIME === "nodejs"`. Auto-start
is itself env-gated (`OUTBOX_WORKER_AUTOSTART`, off under `NODE_ENV==="test"`) so unit
tests import `lib/outbox` and drive `tick()` directly without a live timer.

### Backoff (resolved)

`computeBackoffMs(attempts)` indexes a delay table — default `[60_000, 300_000,
1_800_000, 7_200_000, 21_600_000]` (1m, 5m, 30m, 2h, 6h), overridable via
`OUTBOX_BACKOFF_MS` (comma-separated ms). On the *n*-th failure (`attempts` now `n`):
if `n >= maxAttempts` (`OUTBOX_MAX_ATTEMPTS`, default 6) → `DEAD` with `lastError`;
else `nextAttemptAt = now + table[min(n-1, table.length-1)]`. No jitter — a single
serial worker has no concurrent retries to de-synchronize.

---

## Testing strategy

Tests drive the worker via the exported `tick()` (auto-start stays off under
`NODE_ENV==="test"`); "advancing time" means writing a past `nextAttemptAt` and
calling `tick()` again — no fake timers, no live polling loop.

### Unit
- `computeBackoffMs(n)` returns the table entries and clamps beyond the last.
- `enqueue` writes a `PENDING` row with correct `nextAttemptAt` (respects `delayMs`).
- Worker `tick()`: leases due rows, marks `DONE` on success; on throw, increments
  `attempts`, sets backoff `nextAttemptAt`, flips to `DEAD` at `maxAttempts`;
  unknown type → `DEAD` (no silent drop).
- Email coalescer: N events in one window → exactly one `email.digest` job;
  job payload contains all coalesced events.

### Integration
- Enqueue a failing handler; repeatedly back-date `nextAttemptAt` + `tick()` →
  observe attempt/backoff progression and eventual `DEAD` with `lastError` populated.
- Restart simulation: rows persisted by one `enqueue` are picked up by a fresh
  `tick()` (proves durability across a process restart).

---

## Execution notes (carried from M1/M2)

Isolated worktree; `CI=true` on pnpm; free port 3000 before e2e; rebase onto `main`;
pure libs → services → thin routes → client; value-sets in `lib/enums.ts`.
