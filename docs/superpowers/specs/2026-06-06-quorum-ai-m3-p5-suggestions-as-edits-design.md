---
milestone: M3
phase: P5
slug: quorum-ai-m3-p5-suggestions-as-edits
title: Suggestions-as-edits
status: design-draft
created: 2026-06-06
related:
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-roadmap.md
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-p2-structured-feedback-design.md
---

# M3 / P5 — Suggestions-as-Edits

> Deepens the core review value: reviewers propose **concrete text changes**, not
> just comments, and the author (or agent) accepts them with one click → a new
> version. The groundwork is half-laid: `Annotation.kind` already has a `SUGGESTION`
> value and annotations already carry an anchor range — what's missing is the
> proposed text and an apply path.

## Problem

A reviewer who knows the exact wording they want must describe it in prose; the author
then manually re-types it. There's no machine-applyable suggestion. `kind=SUGGESTION`
exists but is today just a label with no payload and no accept action.

## Goals

- A reviewer can attach **proposed replacement text** to a `SUGGESTION` annotation,
  scoped to its existing anchor range.
- The author/agent can **accept** → the suggested text replaces the anchored span and a
  **new version** is created via the existing `createVersion()` (which re-anchors
  annotations + dismisses approvals), or **reject** → resolves the thread.
- Accepted-suggestion provenance surfaces in the P2 feedback contract ("applied as vN").

## Non-goals (deferred to M4+)

Multi-hunk / multi-anchor patches; automatic conflict resolution when the anchor has
drifted to `ORPHANED` (reject + re-propose instead); suggestion batching ("accept all");
suggestions authored by the machine API (reviewer-side UI only this phase).

---

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Where the proposed text lives | **New nullable `Annotation.suggestedText`**, meaningful only when `kind=SUGGESTION`. Reuses the existing `anchorExact`/`startOffset`/`endOffset` range — no new anchor model. |
| D7 | How `appliedInVersionId` is modeled | **Proper nullable FK relation to `DocumentVersion`** (not a bare string), restrict-delete, matching the existing `createdOnVersion` relation pattern. Lets feedback/UI resolve the applied version *number* directly. _(resolved 2026-06-07)_ |
| D8 | P2 provenance surfacing | **In scope this phase.** Extend `getDocumentDetail` + `lib/feedback.ts` to carry `suggestedText`/applied-version-number and render `[applied as vN]`. _(resolved 2026-06-07)_ |
| D9 | Accept UX | **Diff card + one-click Accept.** The old-span→new-text diff on the suggestion card IS the preview; no separate confirm modal. Accept disabled (with explanation) when anchor is `ORPHANED`. _(resolved 2026-06-07)_ |
| D2 | How apply produces content | **Server computes the new markdown** by replacing the anchored span in the current version's markdown with `suggestedText`, then calls the existing `createVersion()`. Single source of truth for re-anchoring/approval-dismissal stays in `lib/versions.ts`. |
| D3 | Who can accept | **Owner only** (consistent with M2 P1 D3: only the owner creates versions). Reviewers propose; owner disposes. |
| D4 | Stale anchor handling | If the suggestion's anchor is `MOVED`, **re-resolve by exact text**; if `ORPHANED` (text gone), **block accept** with a clear "can't apply — text changed" and let the owner reject/re-request. No silent mis-application. |
| D5 | Concurrency | Apply uses the same **optimistic `baseVersionNumber`** guard as the existing PATCH edit path — accepting against a stale current version → 409, owner refetches. |
| D6 | Thread lifecycle | Accept → thread auto-`RESOLVED` + annotation marked applied (records the resulting version number). Reject → thread `RESOLVED` without applying. |

---

## Data model & migration

### Schema (`prisma/schema.prisma`)

```prisma
// on Annotation:
  suggestedText      String?           // proposed replacement for the anchored span (kind=SUGGESTION)
  appliedInVersionId String?           // set when accepted → which version applied it
  appliedInVersion   DocumentVersion?  @relation("AnnotationAppliedVersion", fields: [appliedInVersionId], references: [id], onDelete: Restrict)

// on DocumentVersion (back-relation):
  appliedSuggestions Annotation[]      @relation("AnnotationAppliedVersion")
```

Additive, nullable. No backfill.

---

## API surface

- **Create suggestion:** extend the existing annotation-create path
  (`POST /api/documents/[id]/annotations`) to accept `kind:"SUGGESTION"` +
  `suggestedText`. Participant-gated (existing rule).
- **Accept:** `POST /api/annotations/[id]/apply` — owner-only; computes new markdown,
  calls `createVersion()`, sets `appliedInVersionId`, resolves the thread. Returns the
  new version (or 409 on stale base, 409/422 on `ORPHANED` anchor).
- **Reject:** reuse the existing thread-status PATCH to `RESOLVED`.

Library: a small `applySuggestion(userId, annotationId, baseVersionNumber)` in
`lib/annotations.ts` that orchestrates span-replacement + `createVersion()` inside one
transaction.

---

## UI

- **Reviewer:** in `components/CommentSidebar.tsx`, a "Suggest edit" mode on a selection
  → captures the range + a proposed-text editor; renders as a diff-styled suggestion
  card (old span → new text).
- **Author/owner:** Accept / Reject buttons on suggestion cards; Accept shows the
  resulting change before committing; disabled with explanation when anchor is orphaned.

---

## Testing strategy

### Unit (`lib/annotations`)
- `applySuggestion` replaces exactly the anchored span and produces correct markdown;
  delegates version creation to `createVersion` (re-anchor + approval-dismiss covered by
  existing version tests).
- `ORPHANED` anchor → apply blocked; `MOVED` anchor → re-resolves by exact text.
- Stale `baseVersionNumber` → 409.

### E2e
- Reviewer (participant) proposes a suggestion on A's plan; owner accepts → new version
  contains the suggested text, thread resolved, `appliedInVersionId` set; prior approvals
  dismissed. Non-owner accept → 403.
- Pull feedback (P2) shows the suggestion as applied-in-vN.

---

## Execution notes

Independent structurally; richest with P2 (provenance surfacing). Isolated worktree;
`CI=true`; preserve `data-testid`/`aria-label` hooks; rebase onto `main`; value-sets in
`lib/enums.ts`.
