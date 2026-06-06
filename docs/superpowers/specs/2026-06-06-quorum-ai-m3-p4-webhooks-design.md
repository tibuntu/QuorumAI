---
milestone: M3
phase: P4
slug: quorum-ai-m3-p4-webhooks
title: Outbound webhooks / status callbacks
status: design-draft
created: 2026-06-06
related:
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-roadmap.md
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-p1-foundations-outbox-design.md
---

# M3 / P4 — Outbound Webhooks / Status Callbacks

> The server-context complement to P3's long-poll. CI pipelines and headless agents
> can't hold a connection open for hours — they want to be **told** when a decision
> lands. This phase lets a user register a signed webhook that Quorum POSTs on review
> events, delivered durably via P1's outbox.

## Problem

There is no outbound integration surface. Notifications today are in-app rows + email;
nothing reaches CI, chatops, or an agent's server. Reliable delivery needs durability,
retry, and signing — exactly what P1's `OutboxJob` provides.

## Goals

- A `Webhook` registration (target URL, signing secret, event filter, scope, active).
- Signed, retried delivery via the outbox worker (handler type `webhook.deliver`).
- Events: `version.created`, `review.updated`, `decision.changed`, `comment.created`.
- Minimal management API + settings UI + a delivery log.

## Non-goals (deferred to M4+)

Dedicated Slack/Teams message formatters (generic JSON webhook only); per-event payload
templating; inbound webhooks; OAuth-protected endpoints (HMAC signing is the trust
mechanism).

---

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Delivery substrate | **Enqueue an `OutboxJob{type:"webhook.deliver"}` per (webhook, event).** Reuse P1's worker for retry/backoff/dead-letter. No new worker. |
| D2 | Signing | **HMAC-SHA256** over the raw body with the webhook's secret; send `X-Quorum-Signature: sha256=…` + `X-Quorum-Timestamp` + `X-Quorum-Event`. Receiver verifies; timestamp guards replay. |
| D3 | Scope | A webhook is **owner-scoped** (fires for the owner's documents) with an optional **single-document** narrowing — matches the owner-strict machine model from M2 P1. |
| D4 | Event source | **Hook the existing fan-out points** (`notifyParticipants` / `publish` in `lib/events.ts`) so webhooks ride the same events as in-app/SSE — one event definition, three sinks (in-app, SSE, webhook). |
| D5 | Secret handling | Secret shown **once** at creation, stored hashed/encrypted at rest (mirror the `ApiToken` reveal-once pattern in `lib/tokens.ts`). |
| D6 | Failure visibility | **Delivery log** (last status, attempts, lastError) so an owner can see a dead webhook instead of silent loss; `DEAD` jobs surface there. |

---

## Data model & migration

### Schema (`prisma/schema.prisma`)

```prisma
model Webhook {
  id          String   @id @default(cuid())
  ownerId     String
  owner       User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  documentId  String?                       // null = all owner's documents
  url         String
  secretHash  String                        // reveal-once; verify via stored secret material
  events      String                        // CSV filter: version.created,review.updated,…
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  lastStatus  String?                       // e.g. "200" | "DEAD"
  lastError   String?
  lastDeliveredAt DateTime?

  @@index([ownerId])
  @@index([documentId])
}
```

`WEBHOOK_EVENTS` value-set added to `lib/enums.ts`. Additive migration; no backfill.

---

## Library + API surface

```ts
// lib/webhooks.ts
dispatch(documentId: string, event: WebhookEvent, payload: unknown): Promise<void>
  // resolve matching active webhooks (owner + doc scope + event filter),
  // enqueue one OutboxJob per match.
```

The `webhook.deliver` handler (registered in `lib/outbox.ts` via `registerHandler`)
signs + POSTs; non-2xx throws → worker retries per P1's backoff.

**Routes** (session-auth, owner-only):
- `POST /api/webhooks` — create (returns secret once).
- `GET /api/webhooks` — list owner's webhooks + delivery status.
- `PATCH /api/webhooks/[id]` — toggle active / edit filter.
- `DELETE /api/webhooks/[id]`.

**UI:** a Settings sub-page (sits beside the M2 notifications settings page) to manage
webhooks and view delivery status.

**Event wiring:** add a `dispatch(...)` call alongside the existing `publish(...)` /
`enqueueEmailEvent(...)` calls in `lib/notifications.ts` and the review/version paths,
including a synthesized `decision.changed` when `computeDocumentState` transitions.

---

## Payload (signed body)

```jsonc
{
  "event": "decision.changed",
  "planId": "doc_…",
  "decision": "approved",
  "version": 4,
  "actor": "Sam",
  "occurredAt": "…"
}
```

Kept small and stable; consumers call back `GET …/feedback` for detail (P2 contract).

---

## Testing strategy

### Unit
- `dispatch` enqueues one job per matching active webhook; respects doc-scope + event
  filter; inactive/non-matching webhooks skipped.
- Signature: deterministic HMAC for a fixed body+secret; timestamp header present.
- Handler marks delivery status; non-2xx throws (→ retry); exhausted attempts → `DEAD`
  + `lastStatus` reflected on the `Webhook`.

### Integration / e2e
- Register a webhook against a local sink; approve a plan → sink receives a signed
  `decision.changed`; tamper the body → signature check fails on the sink side.
- Sink returns 500 thrice → outbox retries then dead-letters; delivery log shows it.

### Security
- SSRF consideration: document/disallow internal-address targets per deployment policy
  (note for the brainstorm — at minimum require https + block link-local/loopback in
  production).

---

## Execution notes

Depends on P1 (outbox + worker). Isolated worktree; `CI=true`; rebase onto `main`;
value-sets in `lib/enums.ts`; reveal-once secret pattern mirrors `lib/tokens.ts`.
