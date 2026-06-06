---
milestone: M2
phase: P1
slug: quorum-ai-m2-p1-authorization
title: Authorization & access control
status: design-approved
created: 2026-06-06
closes_threats: [T-M1-10, T-M1-11, T-M1-12, T-M1-13, T-M1-14, T-M1-15, T-M1-16, T-M1-17, T-M1-18, T-M1-19]
related:
  - docs/superpowers/specs/2026-06-05-quorum-ai-m2-roadmap.md
  - docs/superpowers/security/2026-06-06-quorum-ai-m1-security.md
---

# M2 / P1 — Authorization & Access Control

> Security-critical first phase of M2. Closes the M1 open-access gap: today any
> authenticated web user, or any valid API token, can read or mutate **any**
> document/plan by id (broken object-level authorization — IDOR/BOLA). This phase
> introduces per-document authorization enforced on both the web routes and the
> machine `/api/plans` API, and folds in the two adjacent token-lifecycle / CSRF
> findings from the M1 STRIDE register.

## Problem

The M1 retroactive STRIDE audit (`docs/superpowers/security/2026-06-06-quorum-ai-m1-security.md`)
records a 7-threat HIGH cluster (T-M1-10 … T-M1-16) plus a list-disclosure (T-M1-17),
all sharing one root cause:

> Routes authenticate the caller but never authorize the caller against the
> specific resource, and no `lib/*` service enforces an `ownerId`/participant check.

`Document.ownerId` is written on create but never read for authorization. Two adjacent
findings are folded into this phase: T-M1-18 (API token has no expiry/scope) and
T-M1-19 (no explicit better-auth `trustedOrigins`).

## Goals

- A shared authorization guard (`lib/authz.ts`) enforcing per-document access on every
  object-scoped web route, web page, and machine route.
- Close T-M1-10 … T-M1-19 and update the security register to `threats_open: 0`,
  `status: verified`.

## Non-goals (deferred to M3+)

Team/org model & multi-tenancy; role hierarchies beyond owner/participant; explicit
invite/share UI by email; OIDC/SSO. (Per the M2 roadmap.)

---

## Decisions

These were settled during the phase brainstorm; they drive the rest of the design.

| # | Decision | Choice |
|---|----------|--------|
| D1 | How a non-owner gains access | **Link-grant on first open.** The unguessable document id (cuid) is a bearer capability; opening the document records the viewer as a participant. No invite UI. |
| D2 | Machine `/api/plans` gate | **Owner-strict.** A token may act only on plans whose owner is the token's user. (Machines don't click shared links — they act on plans they pushed.) |
| D3 | Web edit matrix | **Owner edits; participants comment/review.** Only the document owner can create new versions. Any participant may read, annotate, comment, set thread status, submit review verdicts. |
| D4 | Denied status | **404 on object-scoped routes** (don't confirm existence to the non-entitled). **403** only where the resource is already readable by the caller (owner-only edit on a doc you can read). **401** when unauthenticated. |
| D5 | Adjacent findings in scope | **Both** T-M1-19 (CSRF `trustedOrigins`) and T-M1-18 (token expiry + scope) are included. |

---

## Authorization model

The core abstraction is a `DocumentParticipant` join table, **auto-populated on first
open**. This is what makes "link-grant on first open" a real gate rather than mere
list-scoping.

- The **document-detail read is the only auto-join entry point.** When an authenticated
  user opens `GET /api/documents/[id]` or the `/app/documents/[id]` page, we upsert a
  participant row for them — **iff the document exists** (else 404, no row, no existence
  leak). This is the act of "following the link."
- **Every other route checks the table** (`isParticipant`) and does **not** auto-join.
  To comment / review / open the SSE stream, the caller must have opened the document at
  least once. A user with neither the id nor a row is blocked everywhere.
- **Owner** is seeded as a participant on document creation and is also identified
  structurally via `Document.ownerId` (the owner-only edit gate).

### Access rules

| Action | Gate | Denied |
|--------|------|--------|
| Read detail / page | any authed user → **auto-join** (link-grant) | 404 if doc absent |
| SSE stream, create annotation, add comment, submit review, set thread status | **`isParticipant`** | 404 |
| Create version / edit markdown (web + machine) | **`isOwner`** | 403 (web, readable) / 404 (machine) |
| List / inbox | scoped to caller's **participant rows** | — |
| Machine read feedback / push version | **`isOwner`** (token user owns plan) + scope | 404 |

### Honest threat-closure posture

Under the link-grant model, closure differs by route and must be documented precisely in
the security register:

- **Hard-closed:** T-M1-11 (machine write), T-M1-15 (machine feedback), T-M1-17 (list
  enumeration) — non-entitled callers are blocked outright.
- **Practically-closed:** T-M1-12 / T-M1-13 / T-M1-14 / T-M1-16 — the caller must have
  joined via the link (opened the doc) before any write/stream action.
- **Capability-closed:** T-M1-10 (read detail) — access requires possession of the
  unguessable id, which *is* the shared link. This is the deliberate join point and the
  accepted weakness of the link-grant model ("anyone with the link").

---

## Enforcement architecture

**Hybrid (chosen).** A dedicated `lib/authz.ts` owns all participant logic and policy
helpers, called explicitly at each route/page boundary (visible and auditable at the
trust boundary, matching the existing handler style which already performs the
`requireUser` check). **Plus** the two highest-value leaks are also enforced at the data
layer as belt-and-suspenders: `listDocuments(userId)` filters by participant membership,
and `createVersion` re-asserts owner — so a forgetful future route cannot dump all
documents or write a version it shouldn't.

Alternatives considered and rejected:

- **Route-level only:** explicit but relies on remembering the guard on every new route —
  precisely the M1 failure mode. (Mitigated here by the data-layer backstops.)
- **Service-layer only:** a forgetful route inherits the gate, but the same service is
  called with *different* policies (web auto-join vs machine owner-strict), so a service
  can't unilaterally decide; it also churns signatures broadly and tangles the auto-join
  side-effect into a read function.

### `lib/authz.ts` surface

```ts
// Auto-join entry point. Upserts a participant row iff the document exists.
// Returns false when the document does not exist (caller → 404).
ensureParticipant(userId: string, documentId: string): Promise<boolean>

// Membership check only — no side effect.
isParticipant(userId: string, documentId: string): Promise<boolean>

// Owner check (uses Document.ownerId).
isOwner(userId: string, documentId: string): Promise<boolean>

// Resolve a sub-resource to its document for participant checks.
documentIdForAnnotation(annotationId: string): Promise<string | null>
```

Helpers return booleans; route handlers translate to `NextResponse` status codes; server
components call `notFound()`. No exception-mapping framework is introduced — handlers
already return responses directly.

---

## Application matrix

`user` = `requireUser()` (web session) or `requireApiUser()` (machine Bearer). Each entry
maps to a threat in the M1 register.

### Web routes (session)

| Route | Guard added | Denied | Closes |
|-------|-------------|--------|--------|
| `GET /api/documents/[id]` | `ensureParticipant` (auto-join) | 404 if doc absent | T-M1-10 |
| `PATCH /api/documents/[id]` (version) | `isOwner` | 403 | T-M1-11 (web) |
| `GET /api/documents` (list) | `listDocuments(user.id)` scoped | — | T-M1-17 |
| `GET /api/documents/[id]/stream` | `isParticipant` | 404 | T-M1-16 |
| `POST /api/documents/[id]/annotations` | `isParticipant` | 404 | T-M1-12 |
| `POST /api/annotations/[id]/comments` | `documentIdForAnnotation` → `isParticipant` | 404 | T-M1-12 |
| `PATCH /api/annotations/[id]` (thread status) | `documentIdForAnnotation` → `isParticipant` | 404 | T-M1-13 |
| `POST /api/documents/[id]/reviews` | `isParticipant` | 404 | T-M1-14 |

### Web pages (server components)

| Page | Guard | Denied |
|------|-------|--------|
| `/app/documents/[id]` | `ensureParticipant` (auto-join) | `notFound()` |
| `/app` (home list) | `listDocuments(user.id)` | only caller's docs render |

### Machine routes (Bearer token, owner-strict)

| Route | Guard | Denied | Closes |
|-------|-------|--------|--------|
| `PATCH /api/plans/[id]` (version) | `isOwner(token.user.id, id)` + `plans:write` scope | 404 | T-M1-11 (machine) |
| `GET /api/plans/[id]/feedback` | `isOwner` + `feedback:read` scope | 404 | T-M1-15 |
| `POST /api/plans`, `POST /api/documents` | none new (creator = owner) | — | — |

### Notifications

`notifyParticipants` is simplified to read the `DocumentParticipant` table (owner +
joined users) instead of recomputing the set from activity each call — same concern,
cleaner, and it hands P2 (email notifications) a stable participant set directly.

---

## Token lifecycle (T-M1-18) & CSRF (T-M1-19)

### T-M1-19 — CSRF `trustedOrigins` (low)

Add explicit `trustedOrigins` to the better-auth config in `lib/auth.ts`, sourced from
`BETTER_AUTH_URL` plus an optional `TRUSTED_ORIGINS` env list. Config-only.

### T-M1-18 — token expiry + scope (medium)

- **Schema:** `ApiToken.expiresAt DateTime?` and `ApiToken.scopes String`
  (default `"plans:write,feedback:read"` so existing rows keep full access).
- **`verifyToken`:** rejects expired tokens (→ caller 401) and returns the token's
  scopes alongside the user.
- **Scopes enforced in machine routes:** `plans:write` (create + version) and
  `feedback:read` (read feedback). A token missing the needed scope → 403.
- **Token-creation UI** (`/app/settings/tokens`): optional expiry (e.g. 30 / 90 / 365
  days / never) and scope selection. Existing tokens inherit defaults and never expire —
  no behavior change.

---

## Data model & migration

### Schema (`prisma/schema.prisma`)

```prisma
model DocumentParticipant {
  id         String   @id @default(cuid())
  documentId String
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())

  @@unique([documentId, userId])
  @@index([userId])
}
```

Plus back-relations `Document.participants` and `User.documentParticipations`, and on
`ApiToken`: `expiresAt DateTime?`, `scopes String @default("plans:write,feedback:read")`.

### Migration + one-time backfill

1. Create the `DocumentParticipant` table and the two `ApiToken` columns.
2. **Backfill participant rows** for every existing document from
   owner ∪ annotation authors ∪ comment authors ∪ review reviewers (today's
   `notifyParticipants` set, applied once over historical data) — so M1 documents keep
   working and existing reviewers retain access.
3. Existing tokens inherit default scopes and `expiresAt = null` (never expires).

`createDocument` seeds an owner participant row so new documents are consistent from
creation.

---

## Testing strategy

### Unit (`lib/authz`, `lib/tokens`)

- `isParticipant` / `isOwner` true/false paths.
- `ensureParticipant`: joins on first open; returns `false` for an absent document (no
  orphan row).
- `documentIdForAnnotation`: resolves an annotation to its document; `null` when missing.
- `verifyToken`: rejects expired tokens; returns scopes; scope-insufficient path.

### E2e — one assertion per closed threat (users A & B; B lacks the link to A's doc)

- B `GET`s A's doc id → **auto-joins (200)**; A's doc now appears in B's list (link-grant
  works as intended).
- B, against a *second* doc never opened → stream / annotate / comment / review /
  thread-status all return **404** (T-M1-12 / T-M1-13 / T-M1-14 / T-M1-16).
- B (participant) `PATCH`es a version → **403**; owner A → **200** (T-M1-11 web; D3).
- `GET /api/documents` as B → only B's participated docs (T-M1-17).
- Machine: A's token reads/patches A's plan (200); **B's token → 404** on A's plan;
  expired token → **401**; `feedback:read`-only token → **403** on version write
  (T-M1-11 machine / T-M1-15 / T-M1-18).

### Security register update

Flip T-M1-10 … T-M1-19 to `closed` in
`docs/superpowers/security/2026-06-06-quorum-ai-m1-security.md`, each with the precise
disposition (hard- / practically- / capability-closed per the model above). Set
`threats_open: 0`, `threats_open_high: 0`, `status: verified`, and complete the Sign-Off.

---

## Execution notes (carried from M1)

Create an isolated worktree at execution time; this repo's pnpm v11 needs `CI=true` on
script runs; free port 3000 before `pnpm test:e2e`; preserve existing
`data-testid` / `aria-label` test hooks; rebase onto `main` (do not merge `main` in).
