---
milestone: M3
phase: P2
slug: quorum-ai-m3-p2-structured-feedback
title: Structured feedback contract
status: design-final
created: 2026-06-06
related:
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-roadmap.md
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-p1-foundations-outbox-design.md
---

# M3 / P2 — Structured Feedback Contract

> The core of the M3 moat. Today `GET /api/plans/[id]/feedback` returns a flat
> markdown digest with loosely-shaped `threads[]`/`reviews[]` beside it. An agent
> can't reliably ask "what's *blocking*?" or "what's *unresolved*?" without parsing
> prose. This phase turns the response into a **versioned, structured, filterable**
> contract while keeping the human-readable markdown.

## Problem

`consolidateFeedback()` in `lib/feedback.ts` already returns structured `threads[]`
(quote, status, threadStatus, comments) and `reviews[]` (reviewer, verdict, dismissed)
— the data is structured internally and **flattened on the way out**. What's missing:
no severity/category, no stable schema version, no provenance (which version a thread
was raised on vs. now), no rollups, and no way to filter. The `/pull-feedback` skill
therefore presents an undifferentiated wall of comments.

## Goals

- A `schemaVersion`-stamped JSON contract with per-thread `severity`/`category`,
  anchor + resolution state, and **provenance** (current version number + lineage,
  per-thread "raised on vN / now on vN").
- **Rollup counts**: `blocking`, `unresolved`, `byCategory`, `byVersion`, plus the
  existing `decision`.
- **Filtering** via query params on the feedback route.
- `/pull-feedback` skill updated to lead with blockers and unresolved items.

## Non-goals (deferred to M4+)

Rich reviewer triage UI for severity (a minimal affordance to set severity when
commenting is in scope; a dashboard is not); changing the verdict / quorum model;
diffs inside the feedback payload (that's the version-diff UI from M2 P3).

---

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Versioning | **`schemaVersion: 1` literal** in the response. Agents/skills branch on it; future changes bump it additively. |
| D2 | Severity source | **`Annotation.severity`** (added in P1). Nullable → treated as `MINOR` for rollups but reported as `null` (honest). Author/reviewer sets it when creating a comment; optional. |
| D3 | Backward compatibility | **Keep `markdown` and the existing top-level keys** (`decision`, `state`, `threads`, `reviews`). Add new fields; don't remove. Existing `/pull-feedback` callers keep working pre-skill-update. |
| D4 | Filtering semantics | **`include` / `exclude` CSV** of tags: `blocking` (**`severity === "BLOCKER"` only** — annotations have no per-thread link to a review, so the REQUEST_CHANGES dimension stays at the document `decision` level), `unresolved` (threadStatus OPEN), `resolved` (threadStatus RESOLVED), `orphaned` (anchorState ORPHANED). Filters affect `threads[]` only; rollups always reflect the **unfiltered** totals (so the agent sees the true picture). |
| D6 | Severity input affordance | **API field only this phase.** `createAnnotation` + `POST /api/documents/[id]/annotations` accept optional `severity` (validated against `SEVERITIES`, else 400) and `category` (free-form short string). No web UI control — deferred to the UI phase. |
| D7 | Null handling | Null `category` → `"uncategorized"` bucket in `byCategory`. Null `severity` → reported as `null`, never counted as blocking, does not affect `byCategory`. `unresolved` counts `threadStatus === "OPEN"` regardless of severity. `byVersion` keyed by `raisedOnVersion` (string keys). |
| D8 | Data fetching | `getDocumentDetail` (`lib/documents.ts`) must be extended: annotations include `createdOnVersion { versionNumber }`; document includes `versions { versionNumber, createdAt, createdBy }` ordered. Provenance is derivable from existing **rows** but is not currently **fetched**. |
| D5 | Provenance shape | Per thread: `raisedOnVersion` (number) + `currentAnchorState` (ACTIVE/MOVED/ORPHANED). Top level: `currentVersion` (number) + `versions: [{number, createdBy, createdAt}]`. All already derivable from existing rows. |

---

## API surface

`GET /api/plans/[id]/feedback?include=blocking,unresolved&exclude=resolved`

```jsonc
{
  "schemaVersion": 1,
  "decision": "changes_requested",       // unchanged
  "state": "CHANGES_REQUESTED",          // unchanged
  "markdown": "…",                       // unchanged (human digest)
  "currentVersion": 4,
  "versions": [ { "number": 4, "createdBy": "Alex", "createdAt": "…" } ],
  "rollup": {
    "blocking": 2, "unresolved": 5, "total": 9,
    "byCategory": { "security": 2, "scope": 1, "naming": 6 },
    "byVersion": { "3": 4, "4": 5 }
  },
  "threads": [
    {
      "id": "ann_…",
      "quote": "…", "kind": "COMMENT",
      "severity": "BLOCKER", "category": "security",
      "threadStatus": "OPEN", "anchorState": "ACTIVE",
      "raisedOnVersion": 4,
      "comments": [ { "author": "Sam", "body": "…" } ]
    }
  ],
  "reviews": [ { "reviewer": "Sam", "verdict": "REQUEST_CHANGES", "dismissed": false } ]
}
```

Implementation extends `consolidateFeedback()` (`lib/feedback.ts`) — pure function,
unit-testable — and the route adds query-param parsing + filtering. The markdown
builder is reordered to lead with BLOCKER/unresolved threads.

---

## Skill update (`.claude/commands/pull-feedback.md`)

- Read `schemaVersion`; if `>= 1`, present `rollup.blocking` and `rollup.unresolved`
  first, then group threads by `severity`.
- Optionally call with `?include=blocking,unresolved` to focus a revision pass.
- Behaviour on `decision == pending` unchanged.

---

## Testing strategy

### Unit (`lib/feedback`)
- Severity/category surfaced per thread; null severity reported as null but counted as
  MINOR in `byCategory`/rollup-as-specified.
- Rollups computed from the **unfiltered** set even when `include`/`exclude` applied.
- Provenance: `raisedOnVersion` and `anchorState` reflect the annotation's version +
  re-anchor status; `versions[]` ordered.
- `decision`/`state`/`markdown` byte-stable vs. M2 for the no-new-fields path
  (regression guard).

### E2e
- Push plan, add a BLOCKER security thread + a NIT, REQUEST_CHANGES; pull feedback →
  `rollup.blocking == 1`, filtering `include=blocking` returns one thread, rollup still
  shows totals.

---

## Execution notes

Depends on P1 (`Annotation.severity`/`category`). Isolated worktree; `CI=true`; rebase
onto `main`; value-sets (`SEVERITIES`) live in `lib/enums.ts`.
