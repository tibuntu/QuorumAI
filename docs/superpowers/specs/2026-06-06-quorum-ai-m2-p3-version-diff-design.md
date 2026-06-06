# Quorum AI · M2/P3 — Version History + Diff View (Design)

**Status:** Approved design, ready for implementation plan
**Milestone/Phase:** M2 · P3
**Depends on:** M2/P1 Authorization (participant gate) — merged. Independent of P2/P4.
**Date:** 2026-06-06

## Context

Documents accumulate versions as agents revise plans against review feedback, but today only
the **current** version is visible — `getDocumentDetail` returns `currentVersion` only, and
there's no UI to look back. Reviewers and authors can't see *what changed* between revisions,
which is exactly the question a re-review needs answered. P3 adds a read-only history browser
and a diff between any two versions.

Versions already store **full markdown snapshots** per `DocumentVersion` (not deltas), so
diffing is straightforward — no history reconstruction needed.

## Locked decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Where it lives | **Dedicated route** `/app/documents/[id]/history` | Read-only browsing wants room + deep-linkability; mirrors existing page+authz pattern; keeps the large `DocumentView` untouched. Entry via a "History" link in `DocumentView`. |
| D2 | Diff style | **Split side-by-side** (old │ new), **responsive** | Side-by-side on wide screens; stacks vertically on narrow viewports (app has had mobile layout issues). |
| D3 | Granularity | **Line-level with intra-line word highlighting** | Diff the raw **markdown source** (not rendered HTML) line-by-line; highlight changed words within modified lines. |
| D4 | Compute location | **Server-side** in `lib/diff.ts` using the `diff` (jsdiff) package | Pure, unit-testable; page server-component computes and passes structured hunks to a presentational client component. |
| D5 | Access | **Participant-gated, read-only** | Mirror the document GET pattern: `ensureParticipant` → `notFound()`. No new write surface. |
| D6 | Annotation overlay in diff | **Out of scope (v1)** | History shows version content + diff only. Mapping annotations onto historical/diffed versions is deferred. |

## Architecture

### `lib/diff.ts` — pure diff computation (new)
- Add dependency: **`diff`** (jsdiff).
- `diffMarkdown(oldText, newText): DiffLine[]` — returns a structured, side-by-side-ready
  model: an ordered list of rows, each `{ kind: "unchanged" | "added" | "removed" | "changed",
  oldNumber?, newNumber?, oldText?, newText?, wordSpans? }`. For `"changed"` rows, include
  intra-line word-diff spans (jsdiff `diffWords`) so the UI can highlight sub-line edits.
- No I/O, no React — fully unit-testable.

### `lib/versions.ts` — read helpers (extend existing)
- `listVersions(documentId): { versionNumber, createdAt, createdBy: {name}, contentHash }[]`
  — metadata only (no markdown), newest-first.
- `getVersionMarkdown(documentId, versionNumber): string | null` — single snapshot fetch.
- Leaves `createVersion` untouched.

### Route + page
- `app/app/documents/[id]/history/page.tsx` (server component):
  - Session guard → `redirect("/login")`.
  - `ensureParticipant(user.id, id)` → `notFound()` if false (same gate as the doc page).
  - Reads query params `?from=<n>&to=<m>`; **defaults to the latest pair** (`n-1` vs `n`),
    or single-version view when only one version exists.
  - Loads `listVersions`, fetches the two selected snapshots, computes `diffMarkdown`
    server-side, and renders `<VersionHistory>` with the version list + diff model.
- API (for completeness / non-page consumers): `GET /api/documents/[id]/versions` returning
  the `listVersions` payload, participant-gated identically. Diff itself is rendered through
  the page (no separate diff endpoint needed in v1).

### `components/VersionHistory.tsx` — presentational client component (new)
- Left: version list (number, author, relative time via existing `lib/time.ts`).
- Two version selectors (from / to); changing them navigates with updated query params
  (server recomputes — keeps the component dumb and the diff authoritative server-side).
- Diff pane: split side-by-side rows from the diff model, `removed`/`added`/`changed` tinted
  using existing state token CSS vars (`--state-changes-bg`, `--state-approved-bg`), word
  spans highlighted within changed rows. Collapses to stacked (old above new) under `lg`.
- Read-only: no edit/comment affordances.

### Entry point
- Add a "History" link in `components/DocumentView.tsx` near the existing Edit control,
  routing to `/app/documents/[id]/history`.

## Data flow

```
GET /app/documents/[id]/history?from=2&to=3
  → session + ensureParticipant gate (404 on non-participant / missing)
  → listVersions(id)                       // lib/versions.ts (metadata)
  → getVersionMarkdown(id, 2), (id, 3)     // two snapshots
  → diffMarkdown(v2, v3)                    // lib/diff.ts (server)
  → <VersionHistory versions diff />        // presentational
```

## Error handling

- Non-participant or unknown document → `notFound()` (no existence leak, matches P1 D4).
- Invalid/out-of-range `from`/`to` params → fall back to the latest valid pair.
- Single version → show that version's content with a "no earlier version to compare" note.

## Testing

**Unit (`lib/diff.ts`)**
- Identical inputs → all `unchanged` rows.
- Pure addition / pure removal / modified line (asserts `changed` row + word spans).
- Multi-hunk document; line-number alignment across both sides.
- `lib/versions.ts`: `listVersions` ordering + metadata shape; `getVersionMarkdown` hit/miss.

**Integration/e2e**
- Create a doc, edit it twice (3 versions), open `/history`: list shows 3 versions; default
  diff compares v2↔v3; changing the selector to v1↔v3 updates the diff.
- Non-participant (user B without the link) gets 404 on `/history`.

## Out of scope (deferred)

- Annotation/review overlay within the diff; restoring/reverting to an old version;
  exporting diffs; rendered-markdown (WYSIWYG) diffing.

## Files

**New:** `lib/diff.ts`, `components/VersionHistory.tsx`,
`app/app/documents/[id]/history/page.tsx`, `app/api/documents/[id]/versions/route.ts`,
unit tests under `tests/unit/`, an e2e case under `tests/e2e/`.

**Modified:** `lib/versions.ts` (read helpers), `components/DocumentView.tsx` (History link),
`package.json` (+`diff`).
