---
milestone: M3
phase: P1
slug: quorum-ai-m3-p1-foundations-outbox
title: Foundations & durable outbox
status: design-draft
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
| D3 | Email's relationship to the outbox | **Email digest becomes an `OutboxJob` of type `email.digest`.** Debounce stays in a thin in-memory coalescer that, on window close, enqueues one durable job — so a crash mid-window at worst loses ≤45 s of *coalescing*, never an already-scheduled send. |
| D4 | Handler registry | **Typed handler map** keyed by `OutboxJob.type` (`email.digest`, later `webhook.deliver`). Unknown type → `DEAD` (no silent drop). |
| D5 | Backoff | **Exponential with cap** (e.g. 1m, 5m, 30m, 2h, 6h), `maxAttempts` then `DEAD`. Tunable via env. |

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
startOutboxWorker(): void   // idempotent; guarded via globalThis like lib/events.ts
```

`lib/email-digest.ts` keeps its `enqueueEmailEvent(...)` public API (callers in
`lib/notifications.ts` unchanged) but, on debounce-window close, calls
`enqueue("email.digest", { userId, documentId, events })` instead of sending inline.
The `email.digest` handler renders + sends via the existing `lib/email.ts`.

Worker bootstrap: a small `instrumentation.ts` (Next.js) or a server-module import
that runs `startOutboxWorker()` once.

---

## Testing strategy

### Unit
- `enqueue` writes a `PENDING` row with correct `nextAttemptAt`.
- Worker: leases due rows, marks `DONE` on success; on throw, increments `attempts`,
  sets backoff `nextAttemptAt`, flips to `DEAD` at `maxAttempts`; unknown type → `DEAD`.
- Email coalescer: N events in one window → exactly one `email.digest` job;
  job payload contains all coalesced events.

### Integration
- Enqueue a failing handler, advance time → observe attempt/backoff progression and
  eventual `DEAD` with `lastError` populated.
- Restart simulation: rows survive a fresh worker start and are picked up.

---

## Execution notes (carried from M1/M2)

Isolated worktree; `CI=true` on pnpm; free port 3000 before e2e; rebase onto `main`;
pure libs → services → thin routes → client; value-sets in `lib/enums.ts`.
