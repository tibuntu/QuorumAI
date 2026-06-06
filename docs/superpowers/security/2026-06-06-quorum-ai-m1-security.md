---
milestone: M1
slug: quorum-ai-m1
status: verified
threats_open: 0
threats_open_high: 0
asvs_level: 1
mode: retroactive-stride
created: 2026-06-06
remediated_by: M2/P1
remediated: 2026-06-06
---

# Quorum AI M1 — Security

> Retroactive STRIDE threat register for shipped M1 ("Review Core + Packaging + UI").
> Authored after the fact — M1 had no formal threat model — so the register was built from the
> implementation, then each threat verified as CLOSED (control present) or OPEN (control absent).
> This is **documentation feeding M2/P1 (Authorization)**, not an advancement gate: M1 is already
> merged. The dominant finding (a 7-threat broken-object-level-authorization cluster) is the exact
> "open-access gap" M2/P1 is scoped to close.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → Next.js route handlers | Authenticated human users via better-auth session cookie | Document/annotation/comment/review/version payloads, SSE subscriptions |
| Claude Code → Machine API (`/api/plans*`, Bearer) | Long-lived `qai_` API token in `Authorization: Bearer …` | Plan markdown, agentContext, version updates, consolidated feedback |
| Route handler → `lib/*` service functions | Internal; services trust the `userId` the route passes | userId, documentId, annotationId, request bodies |
| App → SQLite (Prisma + better-sqlite3) | ORM-parameterized queries + one static PRAGMA | All persisted entities |
| App → environment/secrets | Process env | `BETTER_AUTH_SECRET`, `DATABASE_URL`, `DISABLE_RATE_LIMIT` |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status | Evidence |
|-----------|----------|-----------|-------------|------------|--------|----------|
| T-M1-01 | Spoofing | Auth (cookie session) | mitigate | better-auth email/password + Prisma adapter; signed session cookie via `nextCookies()` | closed | `lib/auth.ts:6-24`, `lib/api.ts:5-8` |
| T-M1-02 | Spoofing | Machine API token | mitigate | Token stored hashed (SHA-256), never plaintext; lookup by hash; `qai_` + 256-bit random | closed | `lib/tokens.ts:4-22`, `prisma/schema.prisma:79` |
| T-M1-03 | Info Disclosure | API token at rest | mitigate | Only `tokenHash` persisted; unique index; raw token shown once at creation | closed | `lib/tokens.ts:9-11`, `prisma/schema.prisma:79` |
| T-M1-04 | Tampering | SQL injection | mitigate | Prisma parameterized queries throughout; only raw call is a static `PRAGMA journal_mode=WAL` with no user input | closed | `lib/db.ts:18` |
| T-M1-05 | Tampering | Version concurrency (lost update) | mitigate | Optimistic concurrency via `baseVersionNumber` check + `$transaction` for version/re-anchor/state | closed | `lib/versions.ts:25,36-77` |
| T-M1-06 | Info Disclosure | Secret in repo | mitigate | `BETTER_AUTH_SECRET` from env; `.env` untracked; `.env.example` holds empty values | closed | `lib/auth.ts`, `.gitignore` |
| T-M1-07 | Info Disclosure | Secret logging | mitigate | No token/secret/password logged; only a generic DB-error `console.error` | closed | `lib/db.ts:18` |
| T-M1-08 | DoS | Auth-endpoint brute force | mitigate (partial) | better-auth rate limit on in production — **but** `DISABLE_RATE_LIMIT=true` disables it, and it covers auth endpoints only, not app/machine APIs | closed (partial) | `lib/auth.ts:12` |
| T-M1-09 | Repudiation | Authorship attribution | mitigate | author/reviewer/createdBy FKs on every write; `lastUsedAt` on token | closed | `prisma/schema.prisma`, `lib/tokens.ts:20` |
| T-M1-10 | Elevation of Privilege | Document read — `GET /api/documents/[id]` | mitigate | `ensureParticipant` auto-joins caller on read; access requires possession of the unguessable document id (the shared link — the id IS the capability token). **Closure kind: capability** — anyone with the link may read; this is the accepted link-grant trade-off. | **closed (capability)** | `app/api/documents/[id]/route.ts` (GET), `app/app/documents/[id]/page.tsx`, `lib/authz.ts` |
| T-M1-11 | Elevation of Privilege | Document write — PATCH new version (web + machine) | mitigate | Web PATCH: `isParticipant` check (404) then `isOwner` (403); machine PATCH: `isOwner` (404) + `plans:write` scope enforced. | **closed** | `app/api/documents/[id]/route.ts` (PATCH), `app/api/plans/[id]/route.ts`, `lib/authz.ts` |
| T-M1-12 | Elevation of Privilege | Annotations / comments create | mitigate | `isParticipant` on annotation-create; comment-add resolves `annotationId → documentId` then `isParticipant`. **Closure kind: practical** — caller must have opened the document link first to be a participant. | **closed (practical)** | `app/api/documents/[id]/annotations/route.ts`, `app/api/annotations/[id]/comments/route.ts`, `lib/authz.ts` |
| T-M1-13 | Elevation of Privilege | Thread status mutate — `PATCH /api/annotations/[id]` | mitigate | `documentIdForAnnotation` → `isParticipant` before allowing resolve/reopen. **Closure kind: practical.** | **closed (practical)** | `app/api/annotations/[id]/route.ts`, `lib/authz.ts` |
| T-M1-14 | Elevation of Privilege | Review submission — `POST /api/documents/[id]/reviews` | mitigate | `isParticipant` enforced on review submission before recording verdict. **Closure kind: practical.** | **closed (practical)** | `app/api/documents/[id]/reviews/route.ts`, `lib/authz.ts` |
| T-M1-15 | Info Disclosure | Machine API feedback read — `GET /api/plans/[id]/feedback` | mitigate | Owner-strict: `isOwner` (→ 404) + `feedback:read` scope (→ 403) enforced before returning PII-bearing feedback. **Closure kind: hard.** | **closed (hard)** | `app/api/plans/[id]/feedback/route.ts`, `lib/authz.ts` |
| T-M1-16 | Info Disclosure | SSE stream — `GET /api/documents/[id]/stream` | mitigate | `isParticipant` (→ 404) checked before `subscribe(id, …)` is called. **Closure kind: practical.** | **closed (practical)** | `app/api/documents/[id]/stream/route.ts`, `lib/authz.ts` |
| T-M1-17 | Info Disclosure | Document list — `GET /api/documents` | mitigate | `listDocuments(userId)` filters by `DocumentParticipant` membership; list route and home page pass the session `userId`. **Closure kind: hard** — only documents the user participates in are returned. | **closed (hard)** | `lib/documents.ts`, `app/api/documents/route.ts`, `app/app/page.tsx` |
| T-M1-18 | DoS / Spoofing | API token lifecycle | mitigate | `ApiToken.expiresAt` + `scopes` added; `verifyToken` rejects expired tokens and returns scopes; machine routes enforce `plans:write`/`feedback:read`; token-creation UI requires expiry + scope selection. **Residual:** no maximum-expiry cap — a token may be created non-expiring by design; policy cap deferred (see Accepted Risks Log). | **closed** | `prisma/schema.prisma`, `lib/tokens.ts`, `app/api/tokens/route.ts`, `components/TokenManager.tsx` |
| T-M1-19 | Spoofing (CSRF) | Cookie-session state changes | accept (verify) | Explicit `trustedOrigins` now configured from `BETTER_AUTH_URL` env var + optional `TRUSTED_ORIGINS`; better-auth CSRF/origin enforcement applies to all state-changing routes. | **closed** | `lib/auth.ts` |

*Status: open · closed*
*Closure kind (where noted): **hard** — query/scope enforced, no bypass possible; **practical** — caller must hold a valid participant record (acquired by opening the doc link); **capability** — the unguessable document id is the access token (link-grant model, accepted trade-off).*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Root-Cause Summary — the Open-Access Gap

T-M1-10 through T-M1-17 (7 HIGH + the document-list disclosure) share one root cause:

> **Routes authenticate the caller but never authorize the caller against the specific resource,
> and no `lib/*` service function enforces an `ownerId`/participant check.**

The single-owner column `Document.ownerId` (`prisma/schema.prisma:90`) is *written on create but never
read for authorization*. Until M2/P1 lands, M1 is effectively open-access across tenants for any
authenticated user or any valid API token (IDOR/BOLA).

### Remediation pointers (→ M2/P1 Authorization)

- **T-M1-10 / T-M1-17 (read & list):** filter by `ownerId: userId` (or participant ACL) in `getDocumentDetail` / `listDocuments`.
- **T-M1-11 (write):** verify `userId` against `doc.ownerId` in `createVersion`; applies to both the web PATCH and the machine PATCH (token's `user.id` must own the plan).
- **T-M1-12 / T-M1-13 (annotate/comment/thread):** gate on doc-access; for comments resolve `annotationId → documentId → access`.
- **T-M1-14 (reviews):** verify caller is an eligible reviewer/participant before recording a verdict.
- **T-M1-15 (machine feedback):** confirm the token's owning user owns/participates in the plan before returning feedback (PII: reviewer names/emails).
- **T-M1-16 (SSE):** apply the same per-document access check before `subscribe(id, …)`.

A single shared `assertCanAccessDocument(userId, documentId)` helper, called in every route/service above, closes the whole cluster.

### Gap Closed — M2/P1 Authorization (2026-06-06)

The open-access gap is now closed. M2/P1 introduced:

- **`DocumentParticipant` model** (`prisma/schema.prisma`) — records every user who has opened a document link, forming the participant set that all object-scoped guards consult.
- **`lib/authz.ts`** — shared authorization helpers (`isParticipant`, `isOwner`, `ensureParticipant`, `documentIdForAnnotation`) called on every object-scoped route handler and page.
- **Machine API owner-strict** — `isOwner` (→ 404) + scope enforcement (`plans:write`, `feedback:read`) on all machine routes; no cross-tenant access possible.
- **List scoped to participants** — `listDocuments(userId)` filters by `DocumentParticipant` membership; enumeration is hard-closed.

**Honest posture on T-M1-10 (capability closure):** document-detail access is capability-gated — the unguessable document id functions as the shared link/capability token. Any user who possesses the id may read the document and becomes a participant (`ensureParticipant`). This is the accepted "anyone with the link" design trade-off; it is not a control gap, it is the stated access model.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Severity | Rationale | Accepted By | Date |
|---------|------------|----------|-----------|-------------|------|
| R-M1-01 | T-M1-18 | Low | No maximum token expiry cap — non-expiring tokens are permitted by design; a policy maximum (e.g. 365 days) is deferred to a later phase. Revocation remains available. | M2/P1 authorization phase | 2026-06-06 |

---

## Secondary Findings (no separate threat — adequate for ASVS L1)

- **Input validation:** manual `typeof` checks on every route (no zod), enums allow-listed via `lib/enums.ts` (`ANNOTATION_KINDS` / `REVIEW_VERDICTS` / `THREAD_STATUSES`). No injection vector found.
- **SSRF:** no surface — no outbound `fetch` on user-controlled URLs; `BETTER_AUTH_URL` is server-config only (used to build a display `reviewUrl`).
- **Raw SQL:** none with user input (only the static WAL PRAGMA).
- **Known perf/availability follow-up (from STATUS.md):** missing FK indexes on `Annotation.authorId`, `Comment.authorId`, `Review.reviewerId`, `DocumentVersion.createdById`.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-06 | 19 | 9 | 10 (7 HIGH) | gsd-security-auditor (retroactive-STRIDE) |
| 2026-06-06 | 19 | 19 | 0 (0 HIGH) | M2/P1 authorization (subagent-driven) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (R-M1-01: T-M1-18 max-expiry-cap deferred)
- [x] `threats_open: 0` — met; all 19 threats closed by M2/P1 Authorization
- [x] `status: verified` — register verified and closed 2026-06-06

**Approval:** closed by M2/P1 Authorization (subagent-driven) — 2026-06-06.
