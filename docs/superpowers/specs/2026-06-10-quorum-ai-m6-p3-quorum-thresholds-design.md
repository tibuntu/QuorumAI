# M6 · P3 — Quorum / N-Approver Thresholds — Design

> **Milestone:** M6 (Review Depth & Polish) · **Phase:** P3 (final) · **Date:** 2026-06-10
> **Roadmap:** `docs/superpowers/specs/2026-06-10-quorum-ai-m6-roadmap.md`
> **Follows:** M6/P1 (UI polish) + M6/P2 (notification prefs), both shipped on `main`.
> **Execution note:** execution will run in a SEPARATE session via `executing-plans`; the plan + `.tasks.json` must be self-contained.

## Context

Quorum AI's document state machine **already supports N-approver quorum**: `computeDocumentState(reviews, requiredApprovals)` (`lib/review-state.ts:8-13`) returns `APPROVED` only when the count of active (non-dismissed) `APPROVE` reviews is `>= requiredApprovals` (an active `REQUEST_CHANGES` forces `CHANGES_REQUESTED` regardless). `submitReview` passes `doc.requiredApprovals` in (`lib/reviews.ts:18`), and `Document.requiredApprovals Int @default(1)` exists in the schema. But the field is **never set anywhere** (grep confirms: only read in `lib/review-state.ts`, `lib/reviews.ts`, `lib/versions.ts:91`). So every document silently requires exactly 1 approval.

P3 is therefore **purely the config + display + recompute-on-change surface** — no state-machine change.

## Goal

Let a document owner choose how many approvals a plan needs (1–10), set it at creation and edit it later, surface "N of M approvals" progress in the UI and in the machine feedback contract, and recompute document state correctly whenever the threshold changes.

## Scope decisions (made during brainstorming)

- **Edit mechanism:** dedicated settings routes (NOT overloading the version-create PATCH).
- **Validation:** `requiredApprovals` is an integer, `1 <= n <= 10`.
- **Owner control is independent of `EDIT_UI_ENABLED`** (that flag gates content editing; threshold is governance config).
- **Out of scope:** weighted/role-based approvals; requiring specific named reviewers.

## Components

### 1. Validation helper (pure) — `lib/quorum.ts` (new)
- `MAX_REQUIRED_APPROVALS = 10`.
- `parseRequiredApprovals(value: unknown): number | null` — returns the integer if it is a number, integer, and `1 <= n <= 10`; otherwise `null`. Never throws. Used by every create/edit entry point so the bound lives in one place.
- `approvalCount(reviews: { verdict: string; dismissed: boolean }[]): number` — count of active (`!dismissed`) `APPROVE` reviews. Pure; reused by display + feedback so "N" is computed identically everywhere.
- Unit-tested.

### 2. Set on create
- `lib/documents.ts createDocument(userId, title, markdown, opts?)` — add `requiredApprovals?: number` to `opts`; default to `1` when absent (`data: { ..., requiredApprovals: opts?.requiredApprovals ?? 1 }`).
- `app/api/documents/route.ts` (web `POST`) and `app/api/plans/route.ts` (machine `POST`): if `requiredApprovals` is present in the body, validate via `parseRequiredApprovals` → **400** if invalid; pass the parsed value into `createDocument`. Absent → default 1 (unchanged behavior).
- `components/NewDocumentForm.tsx`: add a "Required approvals" number input (`min=1 max=10`, default 1, `aria-label="required approvals"`), include it in the POST body.

### 3. Set on edit — new service + dedicated routes
- **Service** `lib/reviews.ts setRequiredApprovals(userId, documentId, n)`:
  - Assumes the caller already authorized owner + validated `n` (routes do that).
  - Updates `requiredApprovals`, then **recomputes state** over the current reviews and persists it, publishes `review.updated`, and dispatches `decision.changed` if the state changed — identical recompute semantics to `submitReview`.
  - **DRY:** extract the shared recompute tail of `submitReview` into an internal helper (e.g. `recomputeState(documentId): Promise<{ state, prevState }>`) used by BOTH `submitReview` and `setRequiredApprovals`. `submitReview`'s externally observable behavior must not change (it still also calls `notifyParticipants` + the `review.updated` webhook dispatch as today; `setRequiredApprovals` does NOT send a participant notification — no new review occurred — but DOES publish the SSE `review.updated` state change and dispatch `decision.changed` on a flip).
- **Web route** `app/api/documents/[id]/settings/route.ts` (new) — `PATCH`, `requireUser` (session); `isParticipant` ladder → 404, `isOwner` → 403 (mirror the existing document PATCH auth ladder); body `{ requiredApprovals }`; `parseRequiredApprovals` → 400 if invalid; `setRequiredApprovals(...)`; return `{ ok: true, requiredApprovals, state }`.
- **Machine route** `app/api/plans/[id]/settings/route.ts` (new) — `PATCH`, `requireApiUser`; `isOwner` → 404 (mirror plans PATCH); `plans:write` scope → 403; same body/validation/service; return `{ requiredApprovals, state }`.

### 4. Display — `components/DocumentView.tsx`
- Show **"N of M approvals"** in the review bar/sidebar (near the state badge), where `N = approvalCount(reviews)` and `M = requiredApprovals` — both already present in the `getDocumentDetail` payload (it uses `include`, so the `requiredApprovals` scalar + `reviews` are returned). Pure render; no new fetch.
- **Owner-only inline control** to change M: a small number input / stepper (`aria-label="required approvals"`, `data-testid="required-approvals"`) that `PATCH`es `/api/documents/[id]/settings` and reflects the returned state (the SSE `review.updated` already refreshes the badge for everyone). Visible only to the owner; not gated by `EDIT_UI_ENABLED`.
- Preserve all existing `data-testid`/`aria-label`/button names.

### 5. Feedback contract — `lib/feedback.ts consolidateFeedback`
- Add `requiredApprovals` and `approvals` (= `approvalCount`) to the returned JSON, and a line in the rendered markdown (e.g. `Approvals: N of M`), so the agent loop reading `GET /api/plans/[id]/feedback` sees how close the plan is to approval. Keep `schemaVersion` handling consistent (decide in the plan whether this is an additive, non-breaking field — it is additive).

## Edge cases (all handled by the shared recompute in `setRequiredApprovals`)
- Lower the threshold below the current approval count → state flips to `APPROVED`.
- Raise the threshold above the current approvals → state flips back to `OPEN`.
- An active `REQUEST_CHANGES` keeps `CHANGES_REQUESTED` regardless of the threshold.
- Setting the same value is a no-op for state (recompute yields the same result; `decision.changed` not dispatched).

## Verification

- **Unit (`tests/unit`):**
  - `lib/quorum.ts`: `parseRequiredApprovals` accepts 1..10 integers, rejects 0, negatives, >10, non-integers, non-numbers, `null`/`undefined`; `approvalCount` counts only active APPROVE.
  - `setRequiredApprovals`: raising above current approvals → `OPEN`; lowering to/below → `APPROVED`; with an active `REQUEST_CHANGES` → stays `CHANGES_REQUESTED`; persists `requiredApprovals`; returns/sets the recomputed state. (Real test DB, following the `tests/unit/reviews.test.ts` / `notifications.test.ts` pattern.)
  - `createDocument` with `requiredApprovals` persists it; absent → 1.
  - Settings routes: valid → 200/updated; invalid `requiredApprovals` → 400; non-owner → 403; unknown/non-participant → 404. (Mirror `tests/unit/settings.notifications.test.ts` + `reviews.owner-block.test.ts` patterns.)
  - `consolidateFeedback` includes `requiredApprovals` + `approvals`.
- **E2E (`tests/e2e`, new spec):** owner creates a doc with `requiredApprovals = 2`; a non-owner reviewer approves → badge still `Open`, progress shows "1 of 2"; owner lowers the threshold to 1 via the inline control → state becomes `Approved` (SSE-updated). (Owner cannot review own doc — M4/P1 — so use a separate reviewer context.)
- **Full gate:** `CI=true pnpm test:unit`, free port 3000 then `pnpm test:e2e`, `pnpm lint`, `npx tsc --noEmit`, `pnpm build` 0/0.

## Worktree / env notes
Fresh worktree → bootstrap before tests: `CI=true pnpm install`, `.env` with 32+ char `AUTH_SECRET` + `BASE_URL` + `DATABASE_URL=file:./data/app.db`, `pnpm db:deploy` + `pnpm prisma generate`. No schema migration is needed (the `requiredApprovals` column already exists). Rebased onto local `main` (includes P1 + P2). Phase lands by fast-forwarding into local `main`; don't push unless asked. Shell: SCM Breeze breaks `&&`/heredocs — use `/usr/bin/git`, separate calls, Write tool for files.
