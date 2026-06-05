# Quorum AI — Review Core Part 3: Integration & Packaging (Design)

> **Status:** Approved design. Next step: `writing-plans` → implementation plan.
> **Builds on:** Part 1 (documents/annotations/threads/verdicts) and Part 2 (versioning/re-anchoring/SSE) — both merged to `main`.

## Goal

Close the product's hero loop end-to-end: a Claude Code agent **pushes a plan** to a Quorum instance via a Bearer-token machine API, the team reviews it in the web UI (already built), and the agent **pulls consolidated feedback** back into its session to revise — with **in-app notifications** alerting participants, **API-token management** in Settings, the **`/push-plan` + `/pull-feedback` commands shipped in this repo**, and **single-container packaging** finalized.

## Scope

**In scope (this spec):**
1. **Bearer-token machine API:** `POST /api/plans`, `PATCH /api/plans/:id`, `GET /api/plans/:id/feedback`.
2. **API-token auth + management:** `lib/tokens.ts`, token CRUD API, Settings→API-tokens page (generate/revoke + setup snippet).
3. **Feedback consolidation:** `lib/feedback.ts` → injectable markdown digest + structured JSON + a derived `decision`.
4. **In-app notifications:** `Notification` model, participant-based fan-out, inbox page + header unread badge.
5. **CLI commands in-repo:** `.claude/commands/push-plan.md` + `.claude/commands/pull-feedback.md`.
6. **Packaging:** env-conditional `output: standalone` (resolves the `next start` mismatch) + `docker-compose.yml`.

**Out of scope (future):**
- Email notifications (records exist to send from later; no SMTP now).
- Teams / org model (open instance; "participant" = activity-based).
- Historical-version browsing/diff UI (deferred from Part 2).
- Live (SSE) notifications — the inbox is fetched on navigation; no user-scoped event bus in M1.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Plans ↔ data model | Plan = `Document(source=CLAUDE_CODE)`. `POST` creates, `PATCH` revises via Part 2 `createVersion`, `GET …/feedback` consolidates. | Full reuse of existing versioning/annotation/review machinery; "a plan is a reviewable doc" is the thesis. |
| Feedback payload | `{ decision, state, markdown, threads[], reviews[] }`; `decision` derived from doc state. | Injectable markdown for Claude + structured JSON for the CLI to poll/render. |
| Notification recipients | Participants = owner + distinct annotation/comment/review authors, minus the actor. Events: comment, review, version, thread-resolve. | Collaboration without a team model; no notification spam. |
| Email | In-app inbox only. | Self-contained, testable without mail infra; email is a later add-on. |
| CLI delivery | `.claude/commands/*.md` committed to **this** repo; Settings page renders the token + base-URL setup snippet. | One repo, one PR, dogfoodable; no external marketplace. |
| Packaging | `output: process.env.BUILD_STANDALONE ? "standalone" : undefined`; Dockerfile sets the flag; local/e2e use `next start`. | Keeps Docker's standalone server AND fixes the local/e2e `next start` warning. |

## Architecture

Layering unchanged: pure libs → services → thin routes → client. New auth path: Bearer tokens for machine routes; better-auth session for web routes.

### Token auth — `lib/tokens.ts` (service)
- `generateToken(userId, label)` → token string `qai_<base64url(32 random bytes)>`; persist an `ApiToken` row storing only `sha256(token)` as `tokenHash`; return `{ id, token }` (plaintext shown once).
- `verifyToken(bearer)` → strip `Bearer `, `sha256`, look up by `tokenHash`; if found, update `lastUsedAt` and return the `User`; else `null`.
- `listTokens(userId)` → `{ id, label, lastUsedAt, createdAt }[]` (never the hash).
- `revokeToken(userId, id)` → delete, scoped to owner.
- Uses Node `crypto.randomBytes` + `createHash`. Pure logic (token format/hash) is unit-testable; DB roundtrip covered by a service test.
- `ApiToken` model already exists in the schema (Foundation) — no migration needed for tokens.

### `lib/api.ts` (extend)
- Add `requireApiUser(req: Request)` → reads `Authorization` header, delegates to `verifyToken`. Returns user or `null`. Existing `requireUser()` (session) unchanged.

### `lib/documents.ts` (extend)
- `createDocument(userId, title, markdown, opts?: { source?: DocumentSource; agentContext?: string })`. Defaults `source: "WEB"`, `agentContext: undefined` — preserves all Part 1/2 callers.

### Feedback — `lib/feedback.ts` (pure)
- `consolidateFeedback(detail)` where `detail` is the `getDocumentDetail` shape. Returns:
  ```
  {
    decision: "pending" | "approved" | "changes_requested",  // from detail.state
    state: string,
    markdown: string,        // injectable digest for Claude
    threads: { quote: string|null; status: string; threadStatus: string; comments: {author,body}[] }[],
    reviews: { reviewer: string; verdict: string; dismissed: boolean }[],
  }
  ```
- `decision`: `CHANGES_REQUESTED → "changes_requested"`, `APPROVED → "approved"`, else `"pending"`.
- The `markdown` digest lists each thread (quote + comments) and the review tally — formatted to drop straight into a Claude session.
- Pure (no I/O); unit-tested. A thin `getPlanFeedback(id)` service loads detail then calls it.

### Notifications — `lib/notifications.ts` (service) + `Notification` model
- New Prisma model:
  ```
  model Notification {
    id          String   @id @default(cuid())
    userId      String   // recipient
    user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    documentId  String
    document    Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
    type        String   // "comment" | "review" | "version" | "resolve"
    actorId     String?
    read        Boolean  @default(false)
    createdAt   DateTime @default(now())
    @@index([userId, read])
    @@index([documentId])
  }
  ```
  (Add inverse relations on `User` and `Document`.) Migration required.
- `notifyParticipants(documentId, actorId, type)`:
  - Compute participants: document owner + distinct authors of annotations, comments, and reviews on the doc. Remove `actorId`. Insert one `Notification` per remaining recipient.
- Wired into `addComment` (`"comment"`), `submitReview` (`"review"`), `setThreadStatus` (`"resolve"`), `createVersion` (`"version"`) — alongside the existing Part 2 `publish(...)` calls.
- `listNotifications(userId)` → unread-first, newest-first, capped (e.g. 50). `markRead(userId, id)` and `markAllRead(userId)`.

### API routes
**Machine (Bearer, `requireApiUser`):**
- `POST /api/plans` — body `{ title, markdown, agentContext? }`; `createDocument(user.id, title, markdown, { source: "CLAUDE_CODE", agentContext })`; → `{ id, reviewUrl }` (reviewUrl = `${BETTER_AUTH_URL}/app/documents/${id}`). 401/400.
- `PATCH /api/plans/[id]` — body `{ markdown, baseVersionNumber }`; `createVersion(...)`; → version+summary, 409 on stale. 401/400.
- `GET /api/plans/[id]/feedback` — `getPlanFeedback(id)`; → the consolidated payload. 401/404.

**Web (session, `requireUser`):**
- `POST /api/tokens` `{ label }` → `{ id, token }` (once). `GET /api/tokens` → list (no hashes). `DELETE /api/tokens/[id]` → revoke.
- `GET /api/notifications` → list for current user. `PATCH /api/notifications` `{ id?|all:true }` → mark read.

### UI
- **`app/app/settings/tokens/page.tsx`** (server lists tokens) + a client `TokenManager` (create → reveals plaintext once in a copy box; revoke). Renders the **setup snippet**: how to set `QUORUM_API_TOKEN` + `QUORUM_BASE_URL` and that `/push-plan` / `/pull-feedback` ship in the repo's `.claude/commands/`.
- **`app/app/inbox/page.tsx`** + a header bell with unread count (added to the `/app` layout). Each notification deep-links to `/app/documents/:id`; opening marks read.

### CLI commands (in-repo) — `.claude/commands/`
- **`push-plan.md`** (frontmatter `allowed-tools: Bash(curl:*)`, `description`): read the plan (file arg, else last plan/message), `curl -s -X POST "$QUORUM_BASE_URL/api/plans" -H "Authorization: Bearer $QUORUM_API_TOKEN" -H 'content-type: application/json' -d {title,markdown,agentContext}`; print `reviewUrl` + `id`; return control (no blocking).
- **`pull-feedback.md`**: `curl -s "$QUORUM_BASE_URL/api/plans/$1/feedback" -H "Authorization: Bearer $QUORUM_API_TOKEN"`; inject the `markdown` digest into the session for revision; report `decision`. Optional poll until `decision != pending`.

### Packaging
- `next.config.ts`: `output: process.env.BUILD_STANDALONE ? "standalone" : undefined`.
- `Dockerfile` builder stage: `ENV BUILD_STANDALONE=1` before `pnpm build` (runner already runs `node server.js`).
- Add `docker-compose.yml`: build the image, mount a named volume at `/data`, map `3000:3000`, pass `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`.
- Local `pnpm start` and the Playwright `webServer` now use plain `next start` (no standalone warning).

## Data flow

`/push-plan` → `POST /api/plans` (Bearer) → `createDocument(CLAUDE_CODE, agentContext)` → `{id, reviewUrl}`, agent returns control → humans comment/review in the web UI → each mutation fires `notifyParticipants` (inbox) + the Part 2 `publish` (live doc SSE) → `/pull-feedback <id>` → `GET …/feedback` → `consolidateFeedback` digest injected → agent revises → `PATCH /api/plans/:id` → `createVersion` (re-anchor + approval reset).

## Error handling
| Case | Behavior |
|---|---|
| Missing/invalid Bearer token | 401 on all machine routes. |
| Bad machine body | 400. |
| Stale `baseVersionNumber` on PATCH | 409 (reuses Part 2). |
| Feedback for unknown plan | 404. |
| Token shown once | Plaintext returned only on create; never retrievable again (only hash stored). |
| Notification fan-out failure | Best-effort; must not fail the underlying mutation (wrap in try/catch, log). |

## Testing strategy
- **Unit (Vitest):**
  - `tokens.test.ts` — generate→verify roundtrip; wrong/garbage token → null; revoke removes; `listTokens` never leaks hash.
  - `feedback.test.ts` — decision mapping (pending/approved/changes_requested); digest includes thread quotes + comments + review tally.
  - `notifications.test.ts` — participant set = owner+annotators+commenters+reviewers, actor excluded; `markRead`/`markAllRead`.
- **E2E (Playwright):** `tests/e2e/integration.spec.ts`
  - Register → Settings→tokens → create a token (assert shown once) → use Playwright `request` with `Authorization: Bearer` to `POST /api/plans` → assert `{id, reviewUrl}` → `GET …/feedback` → assert `decision: "pending"`.
  - Notifications: user A registers + pushes/creates a plan; user B comments on it; A's `/app/inbox` shows a "comment" notification deep-linking to the doc; unread badge reflects it.
- Plugin command files validated by structure + manual dogfooding (not in CI).

## Components & build order (units)
1. **Notification schema** — model + inverse relations + migration. *(independent)*
2. **`lib/tokens.ts`** + tests. *(independent)*
3. **`lib/feedback.ts`** + tests. *(independent)*
4. **`createDocument` source/agentContext option** + `requireApiUser` in `lib/api.ts`. *(independent; small)*
5. **`lib/notifications.ts`** + tests; wire into the four mutation services. *(blocked by 1)*
6. **Machine API routes** (`/api/plans` POST, `[id]` PATCH, `[id]/feedback` GET). *(blocked by 3, 4)*
7. **Token API + Settings UI** (token CRUD routes + tokens page + setup snippet). *(blocked by 2)*
8. **Notifications API + inbox UI + header badge.** *(blocked by 5)*
9. **CLI commands** `.claude/commands/push-plan.md` + `pull-feedback.md`. *(blocked by 6, 7)*
10. **Packaging** — env-conditional standalone + Dockerfile flag + `docker-compose.yml`. *(independent)*
11. **E2E** — machine-API token flow + notifications. *(blocked by 6, 7, 8)*

## Conventions (carried from Parts 1–2)
- Plain commit messages, **no `Co-Authored-By` / AI attribution trailer**.
- Shell has SCM Breeze — use Write/Edit (not heredocs), single-line Bash, prefer `command git`.
- Next 16 route handlers: `params` is a Promise (`const { id } = await params`).
- Deterministic logic in pure libs; DB in services; routes thin. Value-sets in `lib/enums.ts`.
- Branch `part-3-packaging`; rebase onto `main` if it advances (don't merge main in).
