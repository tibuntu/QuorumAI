# M3 / P5 — Suggestions-as-Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer attach proposed replacement text to a `SUGGESTION` annotation, and let the document owner accept it with one click → the suggested text replaces the anchored span via a new version created through the existing `createVersion()`.

**Architecture:** Additive, nullable schema fields (`Annotation.suggestedText`, `Annotation.appliedInVersionId` + FK relation). Core orchestration is a new `applySuggestion()` in `lib/annotations.ts` that re-resolves the anchor against current markdown (D4), splices in the suggested text, and delegates version creation (re-anchoring + approval-dismissal) to `lib/versions.ts` — single source of truth, no fork. A new owner-only `POST /api/annotations/[id]/apply` route maps domain errors to HTTP (403/409/422). Provenance surfaces through `lib/feedback.ts` ("applied as vN"). The reviewer/owner UI lives in `components/CommentSidebar.tsx` + `components/DocumentView.tsx`.

**Tech Stack:** Next.js (App Router), Prisma, TypeScript, Vitest (unit), Playwright (e2e). `react-markdown` + `remark-gfm` for rendering.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `prisma/schema.prisma` | Data model | Add `suggestedText`, `appliedInVersionId` + relation on `Annotation`; back-relation on `DocumentVersion` |
| `prisma/migrations/*` | Migration | New migration for the two columns + FK |
| `lib/annotations.ts` | Annotation domain logic | Extend `createAnnotation` to persist `suggestedText`; add `applySuggestion()` + `OrphanedAnchorError` |
| `app/api/documents/[id]/annotations/route.ts` | Create-annotation API | Accept `suggestedText` when `kind="SUGGESTION"` |
| `app/api/annotations/[id]/apply/route.ts` | Apply API | New owner-only route; 403/409/422 mapping |
| `lib/documents.ts` | Detail query | Include `appliedInVersion.versionNumber` in `getDocumentDetail` |
| `lib/feedback.ts` | P2 feedback contract | Render `[applied as vN]` provenance |
| `components/DocumentView.tsx` | Client state + wiring | "Suggest edit" mode; apply call; thread `kind`/`suggestedText`/`appliedInVersionNumber`; pass `isOwner` |
| `app/app/documents/[id]/page.tsx` | Server page | Pass `isOwner` + new annotation fields to `DocumentView` |
| `components/CommentSidebar.tsx` | Suggestion UI | Diff-styled suggestion card; owner Accept/Reject; orphaned-disabled |
| `tests/unit/annotations.test.ts` | Unit tests | `applySuggestion` cases |
| `tests/unit/feedback.test.ts` | Unit tests | Provenance rendering |
| `tests/e2e/suggestions.spec.ts` | e2e | Reviewer proposes → owner accepts; non-owner 403; feedback shows applied-in-vN |

---

### Task 1: Schema + migration for suggestion fields

**Goal:** Add the two nullable fields and the FK relation to the Prisma schema and generate a migration.

**Files:**
- Modify: `prisma/schema.prisma` (Annotation model ~lines 133-157; DocumentVersion model ~lines 114-131)
- Create: `prisma/migrations/<timestamp>_p5_suggestions/migration.sql` (generated)

**Acceptance Criteria:**
- [ ] `Annotation.suggestedText String?` and `Annotation.appliedInVersionId String?` exist.
- [ ] `Annotation.appliedInVersion` relation (`"AnnotationAppliedVersion"`, `onDelete: Restrict`) and `DocumentVersion.appliedSuggestions` back-relation exist.
- [ ] `npx prisma validate` passes; migration generated; client regenerated.

**Verify:** `npx prisma validate && npx prisma migrate status` → schema valid, migration applied.

**Steps:**

- [ ] **Step 1: Add fields to the `Annotation` model**

In `prisma/schema.prisma`, inside `model Annotation`, after the `comments Comment[]` line (and before the `@@index` lines), add:

```prisma
  suggestedText      String?
  appliedInVersionId String?
  appliedInVersion   DocumentVersion? @relation("AnnotationAppliedVersion", fields: [appliedInVersionId], references: [id], onDelete: Restrict)
```

Add an index for the new FK alongside the existing `@@index` lines:

```prisma
  @@index([appliedInVersionId])
```

- [ ] **Step 2: Add the back-relation to `DocumentVersion`**

In `model DocumentVersion`, next to the existing `annotationsCreated Annotation[] @relation("AnnotationVersion")` line, add:

```prisma
  appliedSuggestions Annotation[] @relation("AnnotationAppliedVersion")
```

- [ ] **Step 3: Validate the schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Generate the migration + client**

Run: `npx prisma migrate dev --name p5_suggestions`
Expected: migration created under `prisma/migrations/`, applied to the dev DB, and `Generated Prisma Client`. (The dev DB is per-checkout and the client is gitignored — this is expected.)

- [ ] **Step 5: Typecheck**

Run: `rtk tsc --noEmit`
Expected: no errors (generated client now knows the new fields).

- [ ] **Step 6: Commit**

```bash
rtk git add prisma/schema.prisma prisma/migrations
rtk git commit -m "feat(m3-p5): add Annotation.suggestedText + appliedInVersion FK"
```

---

### Task 2: `applySuggestion()` + `createAnnotation` suggestedText (lib, TDD)

**Goal:** Add the core domain logic: persist `suggestedText` on create, and `applySuggestion()` that splices the suggestion into current markdown and delegates to `createVersion()`.

**Files:**
- Modify: `lib/annotations.ts`
- Test: `tests/unit/annotations.test.ts`

**Acceptance Criteria:**
- [ ] `createAnnotation` persists `suggestedText` when provided in the anchor arg.
- [ ] `applySuggestion` replaces exactly the (re-resolved) anchored span and calls `createVersion`; sets `appliedInVersionId` + `threadStatus="RESOLVED"`.
- [ ] `MOVED` anchor → re-resolves by exact/fuzzy text and applies at the relocated offsets.
- [ ] `ORPHANED` anchor → throws `OrphanedAnchorError`, no version created.
- [ ] Stale `baseVersionNumber` → `ConcurrencyError` propagates (from `createVersion`).
- [ ] Non-SUGGESTION / already-applied / missing `suggestedText` → throws.

**Verify:** `rtk vitest run tests/unit/annotations.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/annotations.test.ts` (reuse the existing imports; add `applySuggestion`, `OrphanedAnchorError` to the `@/lib/annotations` import and `ConcurrencyError` from `@/lib/versions`, `getVersionMarkdown` from `@/lib/versions`):

```typescript
import { createAnnotation, addComment, setThreadStatus, applySuggestion, OrphanedAnchorError } from "@/lib/annotations";
import { ConcurrencyError, getVersionMarkdown } from "@/lib/versions";

describe("applySuggestion", () => {
  async function setup(markdown: string) {
    const user = await prisma.user.create({
      data: { email: `s-${Date.now()}-${Math.round(Math.random() * 1e6)}@e.com`, name: "S", passwordHash: "x" },
    });
    const docId = await createDocument(user.id, "Plan", markdown);
    return { userId: user.id, docId };
  }

  function suggestAnchor(md: string, phrase: string, suggestedText: string) {
    const start = md.indexOf(phrase);
    return {
      quote: buildQuote(md, start, start + phrase.length),
      startOffset: start,
      endOffset: start + phrase.length,
      kind: "SUGGESTION" as const,
      suggestedText,
    };
  }

  it("replaces exactly the anchored span and creates a new version", async () => {
    const md = "The cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const ann = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");

    const result = await applySuggestion(userId, ann.id, 1);

    expect(result.version.versionNumber).toBe(2);
    const v2 = await getVersionMarkdown(docId, 2);
    expect(v2).toBe("The k8s cluster needs review.");
    const reloaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(reloaded?.threadStatus).toBe("RESOLVED");
    expect(reloaded?.appliedInVersionId).toBe(result.version.id);
  });

  it("re-resolves a MOVED anchor and applies at the relocated span", async () => {
    const md = "Intro line.\n\nThe cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const ann = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");
    // Owner edits unrelated text so the anchor's offsets shift (still present).
    await createVersion(userId, docId, 1, "Intro line, expanded a lot.\n\nThe cloud setup needs review.");

    const result = await applySuggestion(userId, ann.id, 2);
    const latest = await getVersionMarkdown(docId, 3);
    expect(latest).toContain("The k8s cluster needs review.");
    expect(result.version.versionNumber).toBe(3);
  });

  it("blocks apply when the anchor is ORPHANED", async () => {
    const md = "The cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const ann = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");
    // Owner deletes the anchored text entirely.
    await createVersion(userId, docId, 1, "Totally different content now.");

    await expect(applySuggestion(userId, ann.id, 2)).rejects.toBeInstanceOf(OrphanedAnchorError);
    const reloaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(reloaded?.appliedInVersionId).toBeNull();
  });

  it("rejects a stale baseVersionNumber with ConcurrencyError", async () => {
    const md = "The cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const ann = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");
    await createVersion(userId, docId, 1, "The cloud setup needs review. (touched)");

    await expect(applySuggestion(userId, ann.id, 1)).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("rejects non-suggestion and already-applied annotations", async () => {
    const md = "The cloud setup needs review.";
    const { userId, docId } = await setup(md);
    const comment = await createAnnotation(userId, docId, {
      quote: buildQuote(md, 4, 15), startOffset: 4, endOffset: 15,
    }, "just a comment");
    await expect(applySuggestion(userId, comment.id, 1)).rejects.toThrow();

    const sugg = await createAnnotation(userId, docId, suggestAnchor(md, "cloud setup", "k8s cluster"), "rename");
    await applySuggestion(userId, sugg.id, 1);
    await expect(applySuggestion(userId, sugg.id, 2)).rejects.toThrow(/already applied/);
  });
});
```

Ensure the test file imports `createDocument` (`@/lib/documents`), `buildQuote` (`@/lib/anchoring`), `createVersion` (`@/lib/versions`), and `prisma` (`@/lib/db`) — match the existing imports at the top of the file, adding any that are missing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk vitest run tests/unit/annotations.test.ts`
Expected: FAIL — `applySuggestion`/`OrphanedAnchorError` not exported.

- [ ] **Step 3: Extend `createAnnotation` to persist `suggestedText`**

In `lib/annotations.ts`, widen the `anchor` parameter type and pass the field through:

```typescript
export async function createAnnotation(
  userId: string,
  documentId: string,
  anchor: { quote: Quote; startOffset: number; endOffset: number; kind?: AnnotationKind; suggestedText?: string | null },
  body: string
) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");
  const annotation = await prisma.annotation.create({
    data: {
      documentId,
      createdOnVersionId: doc.currentVersionId,
      kind: anchor.kind ?? "COMMENT",
      suggestedText: anchor.kind === "SUGGESTION" ? (anchor.suggestedText ?? null) : null,
      anchorExact: anchor.quote.exact,
      anchorPrefix: anchor.quote.prefix,
      anchorSuffix: anchor.quote.suffix,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      authorId: userId,
      comments: { create: { authorId: userId, body } },
    },
    include: { comments: { include: { author: { select: { name: true, email: true } } } }, author: { select: { name: true, email: true } } },
  });
  publish(documentId, { type: "annotation.created", annotation });
  await notifyParticipants(documentId, userId, "comment").catch(() => {});
  return annotation;
}
```

- [ ] **Step 4: Add `OrphanedAnchorError` and `applySuggestion`**

Add to the top imports of `lib/annotations.ts`:

```typescript
import { relocate } from "@/lib/anchoring";
import { createVersion } from "@/lib/versions";
```

Then add at the end of the file:

```typescript
export class OrphanedAnchorError extends Error {
  constructor(message = "anchor text no longer present") {
    super(message);
    this.name = "OrphanedAnchorError";
  }
}

/**
 * Owner-accepts a SUGGESTION: re-resolve its anchor against the *current*
 * markdown (D4), splice in `suggestedText`, and create a new version via the
 * existing createVersion() (which owns re-anchoring + approval dismissal — D2).
 * On success the thread is RESOLVED and `appliedInVersionId` records the result.
 *
 * Authorization (owner-only, D3) is enforced at the route, not here, so unit
 * tests can drive the logic directly with the owner's id.
 */
export async function applySuggestion(userId: string, annotationId: string, baseVersionNumber: number) {
  const annotation = await prisma.annotation.findUnique({
    where: { id: annotationId },
    include: { document: { include: { currentVersion: true } } },
  });
  if (!annotation) throw new Error("annotation not found");
  if (annotation.kind !== "SUGGESTION") throw new Error("not a suggestion");
  if (annotation.suggestedText == null) throw new Error("suggestion has no proposed text");
  if (annotation.appliedInVersionId) throw new Error("suggestion already applied");
  const current = annotation.document.currentVersion;
  if (!current) throw new Error("document has no current version");

  // D4: re-resolve against current markdown. MOVED → use relocated span;
  // ORPHANED → block (no silent mis-application).
  const reloc = relocate(current.markdown, {
    exact: annotation.anchorExact ?? "",
    prefix: annotation.anchorPrefix ?? "",
    suffix: annotation.anchorSuffix ?? "",
  });
  if (reloc.status === "ORPHANED" || !reloc.range) throw new OrphanedAnchorError();

  const { start, end } = reloc.range;
  const newMarkdown = current.markdown.slice(0, start) + annotation.suggestedText + current.markdown.slice(end);

  // D5: createVersion enforces the optimistic baseVersionNumber guard
  // (stale → ConcurrencyError). We call it as the single source of truth for
  // version creation rather than forking its transaction.
  const result = await createVersion(userId, annotation.documentId, baseVersionNumber, newMarkdown);

  // If suggestedText equals the existing span the content hash is unchanged and
  // no version is created; the suggestion still counts as applied to the current
  // version and the thread resolves.
  const appliedVersionId = result.unchanged ? current.id : result.version.id;
  const appliedVersionNumber = result.unchanged ? current.versionNumber : result.version.versionNumber;

  const updated = await prisma.annotation.update({
    where: { id: annotationId },
    data: { appliedInVersionId: appliedVersionId, threadStatus: "RESOLVED" },
  });
  publish(annotation.documentId, { type: "annotation.updated", annotationId, threadStatus: "RESOLVED" });

  return { version: { id: appliedVersionId, versionNumber: appliedVersionNumber }, annotation: updated };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `rtk vitest run tests/unit/annotations.test.ts`
Expected: PASS (all `applySuggestion` cases + the existing "creates, replies, resolves" test).

- [ ] **Step 6: Commit**

```bash
rtk git add lib/annotations.ts tests/unit/annotations.test.ts
rtk git commit -m "feat(m3-p5): applySuggestion + suggestedText on createAnnotation"
```

---

### Task 3: API — apply route + create-annotation suggestedText

**Goal:** Add owner-only `POST /api/annotations/[id]/apply` and let the create route accept `suggestedText`.

**Files:**
- Create: `app/api/annotations/[id]/apply/route.ts`
- Modify: `app/api/documents/[id]/annotations/route.ts`

**Acceptance Criteria:**
- [ ] `POST /api/annotations/[id]/apply` → owner: 200 with `{ version, annotation }`; non-owner participant: 403; orphaned anchor: 422; stale base: 409; missing/invalid body: 400.
- [ ] Create route accepts `kind:"SUGGESTION"` + `suggestedText` and forwards it to `createAnnotation`.

**Verify:** `rtk tsc --noEmit` passes; behavior covered by Task 6 e2e.

**Steps:**

- [ ] **Step 1: Create the apply route**

Create `app/api/annotations/[id]/apply/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { isParticipant, isOwner, documentIdForAnnotation } from "@/lib/authz";
import { applySuggestion, OrphanedAnchorError } from "@/lib/annotations";
import { ConcurrencyError } from "@/lib/versions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const documentId = await documentIdForAnnotation(id);
  if (!documentId) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Non-participants must not learn the annotation exists (404); a participant
  // who is not the owner may not apply (403). Mirrors the PATCH edit path.
  if (!(await isParticipant(user.id, documentId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await isOwner(user.id, documentId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.baseVersionNumber !== "number") {
    return NextResponse.json({ error: "baseVersionNumber required" }, { status: 400 });
  }

  try {
    const result = await applySuggestion(user.id, id, body.baseVersionNumber);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ConcurrencyError) return NextResponse.json({ error: "stale version" }, { status: 409 });
    if (e instanceof OrphanedAnchorError) return NextResponse.json({ error: "anchor text changed; cannot apply" }, { status: 422 });
    throw e;
  }
}
```

- [ ] **Step 2: Extend the create-annotation route**

In `app/api/documents/[id]/annotations/route.ts`, the POST handler already reads `kind` and validates against `ANNOTATION_KINDS`. Pull `suggestedText` from the body and forward it. Locate the `createAnnotation(...)` call and the destructured body, and update them so the anchor object includes `suggestedText`:

```typescript
const { quote, startOffset, endOffset, body: text, kind, suggestedText } = body;
// ... existing validation of quote/offsets/text/kind ...
const annotation = await createAnnotation(
  user.id,
  id,
  { quote, startOffset, endOffset, kind, suggestedText },
  text
);
```

(Do not add new validation gates beyond the existing ones — `suggestedText` is optional and only persisted when `kind==="SUGGESTION"`, enforced inside `createAnnotation`.)

- [ ] **Step 3: Typecheck**

Run: `rtk tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
rtk git add app/api/annotations/\[id\]/apply/route.ts app/api/documents/\[id\]/annotations/route.ts
rtk git commit -m "feat(m3-p5): owner-only apply route + suggestedText on create"
```

---

### Task 4: P2 provenance — feedback shows "applied as vN" (TDD)

**Goal:** Surface accepted-suggestion provenance in the consolidated feedback contract.

**Files:**
- Modify: `lib/documents.ts` (include `appliedInVersion.versionNumber`)
- Modify: `lib/feedback.ts`
- Test: `tests/unit/feedback.test.ts`

**Acceptance Criteria:**
- [ ] `getDocumentDetail` includes `appliedInVersion: { versionNumber }` on each annotation.
- [ ] `consolidateFeedback` appends `[applied as vN]` to a thread whose suggestion was applied.

**Verify:** `rtk vitest run tests/unit/feedback.test.ts` → pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/feedback.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { consolidateFeedback, type FeedbackDetail } from "@/lib/feedback";

describe("consolidateFeedback provenance", () => {
  it("marks an applied suggestion as applied-in-vN", () => {
    const detail: FeedbackDetail = {
      state: "OPEN",
      annotations: [
        {
          anchorExact: "cloud setup",
          status: "ORPHANED",
          threadStatus: "RESOLVED",
          kind: "SUGGESTION",
          suggestedText: "k8s cluster",
          appliedInVersion: { versionNumber: 2 },
          comments: [{ body: "rename it", author: { name: "Rev" } }],
        },
      ],
      reviews: [],
    };
    const { markdown } = consolidateFeedback(detail);
    expect(markdown).toContain("[applied as v2]");
  });

  it("does not mark unapplied threads", () => {
    const detail: FeedbackDetail = {
      state: "OPEN",
      annotations: [
        { anchorExact: "cloud setup", status: "ACTIVE", threadStatus: "OPEN", comments: [{ body: "hm" }] },
      ],
      reviews: [],
    };
    expect(consolidateFeedback(detail).markdown).not.toContain("applied as");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `rtk vitest run tests/unit/feedback.test.ts`
Expected: FAIL — type error / `[applied as v2]` absent.

- [ ] **Step 3: Extend the `FeedbackDetail` type and rendering**

In `lib/feedback.ts`, widen the annotation shape and append the provenance tag. Replace the `FeedbackDetail` interface and the thread-tags line:

```typescript
export interface FeedbackDetail {
  state: string;
  annotations: {
    anchorExact: string | null;
    status: string;
    threadStatus: string;
    kind?: string;
    suggestedText?: string | null;
    appliedInVersion?: { versionNumber: number } | null;
    comments: { body: string; author?: Author }[];
  }[];
  reviews: { verdict: string; dismissed: boolean; reviewer?: Author }[];
}
```

In `consolidateFeedback`, carry the applied-version onto the mapped thread:

```typescript
  const threads = detail.annotations.map((a) => ({
    quote: a.anchorExact,
    status: a.status,
    threadStatus: a.threadStatus,
    appliedInVersion: a.appliedInVersion ?? null,
    comments: a.comments.map((c) => ({ author: authorName(c.author ?? null), body: c.body })),
  }));
```

And extend the per-thread `tags` to include provenance:

```typescript
  for (const t of threads) {
    const applied = t.appliedInVersion ? ` [applied as v${t.appliedInVersion.versionNumber}]` : "";
    const tags = `${t.status === "ORPHANED" ? " (orphaned)" : t.status === "MOVED" ? " (moved)" : ""}${t.threadStatus === "RESOLVED" ? " [resolved]" : ""}${applied}`;
    lines.push(`## On "${t.quote ?? "(unanchored)"}"${tags}`);
    for (const c of t.comments) lines.push(`- **${c.author}:** ${c.body}`);
    lines.push("");
  }
```

- [ ] **Step 4: Include the relation in `getDocumentDetail`**

In `lib/documents.ts`, inside the `annotations.include` block, add the applied-version relation:

```typescript
      annotations: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { name: true, email: true } },
          comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, email: true } } } },
          appliedInVersion: { select: { versionNumber: true } },
        },
      },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `rtk vitest run tests/unit/feedback.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
rtk tsc --noEmit
rtk git add lib/feedback.ts lib/documents.ts tests/unit/feedback.test.ts
rtk git commit -m "feat(m3-p5): surface applied-suggestion provenance in feedback"
```

---

### Task 5: Suggestion UI — reviewer proposes, owner accepts

**Goal:** Reviewer can switch a selection into "Suggest edit" mode and propose replacement text; the owner sees a diff-styled card with Accept/Reject (one-click; diff is the preview).

**Files:**
- Modify: `components/DocumentView.tsx`
- Modify: `components/CommentSidebar.tsx`
- Modify: `app/app/documents/[id]/page.tsx`

**Acceptance Criteria:**
- [ ] `ClientAnnotation` carries `kind`, `suggestedText`, `appliedInVersionNumber`; all four mapping sites (page serialize, `submitComment`, `refetchDetail`, SSE `annotation.created`) populate them.
- [ ] Selection card offers "Suggest edit" → a "Proposed text" editor (prefilled with the selected text) + "Suggest" button → POST with `kind:"SUGGESTION"` + `suggestedText`.
- [ ] Suggestion threads render a diff card (old span struck-through → new `suggestedText`), `data-testid="suggestion"`.
- [ ] Owner sees **Accept** / **Reject**; Accept disabled with explanation when anchor status is `ORPHANED`; applied suggestions show "Applied as vN" and no buttons.
- [ ] `isOwner` is threaded page → `DocumentView` → `CommentSidebar`; non-owners see no Accept/Reject.
- [ ] Existing `data-testid` (`thread`, `doc-body`, `doc-state`, `orphaned-section`) and `aria-label` (`reply`, `comment`) hooks are preserved.

**Verify:** `rtk tsc --noEmit` passes; behavior covered by Task 6 e2e.

**Steps:**

- [ ] **Step 1: Extend `ClientAnnotation` + the page**

In `components/DocumentView.tsx`, add to the `ClientAnnotation` interface:

```typescript
export interface ClientAnnotation {
  id: string;
  anchorExact: string | null;
  anchorPrefix: string | null;
  anchorSuffix: string | null;
  startOffset: number | null;
  endOffset: number | null;
  threadStatus: string;
  status: string;
  kind: string;
  suggestedText: string | null;
  appliedInVersionNumber: number | null;
  comments: ClientComment[];
}
```

In `app/app/documents/[id]/page.tsx`, add the new fields to the serialized annotations and compute `isOwner`:

```typescript
    annotations: doc.annotations.map((a) => ({
      id: a.id,
      anchorExact: a.anchorExact,
      anchorPrefix: a.anchorPrefix,
      anchorSuffix: a.anchorSuffix,
      startOffset: a.startOffset,
      endOffset: a.endOffset,
      threadStatus: a.threadStatus,
      status: a.status,
      kind: a.kind,
      suggestedText: a.suggestedText,
      appliedInVersionNumber: a.appliedInVersion?.versionNumber ?? null,
      comments: a.comments.map((c) => ({ id: c.id, body: c.body, author: c.author })),
    })),
  };

  const isOwner = doc.ownerId === session.user.id;
  return <DocumentView doc={serializable} isOwner={isOwner} />;
```

- [ ] **Step 2: Add suggest-mode state + apply handler in `DocumentView`**

Change the component signature and add state:

```typescript
export default function DocumentView({ doc, isOwner }: { doc: ClientDocument; isOwner: boolean }) {
```

Add near the other `useState` hooks:

```typescript
  const [suggesting, setSuggesting] = useState(false);
  const [suggestDraft, setSuggestDraft] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
```

In `submitComment`, the created mapping must include the new fields (kind COMMENT, null suggestion):

```typescript
      const created: ClientAnnotation = {
        id: annotation.id,
        anchorExact: annotation.anchorExact,
        anchorPrefix: annotation.anchorPrefix,
        anchorSuffix: annotation.anchorSuffix,
        startOffset: annotation.startOffset,
        endOffset: annotation.endOffset,
        threadStatus: annotation.threadStatus,
        status: annotation.status ?? "ACTIVE",
        kind: annotation.kind ?? "COMMENT",
        suggestedText: annotation.suggestedText ?? null,
        appliedInVersionNumber: null,
        comments: (annotation.comments ?? []).map((c: ClientComment) => ({ id: c.id, body: c.body, author: c.author })),
      };
```

Add a `submitSuggestion` function next to `submitComment`:

```typescript
  async function submitSuggestion() {
    if (!selection || !suggestDraft.trim()) return;
    const res = await fetch(`/api/documents/${doc.id}/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quote: selection.quote,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        kind: "SUGGESTION",
        suggestedText: suggestDraft,
        body: pendingBody.trim() || "Suggested edit",
      }),
    });
    if (res.status === 201) {
      const { annotation } = await res.json();
      const created: ClientAnnotation = {
        id: annotation.id,
        anchorExact: annotation.anchorExact,
        anchorPrefix: annotation.anchorPrefix,
        anchorSuffix: annotation.anchorSuffix,
        startOffset: annotation.startOffset,
        endOffset: annotation.endOffset,
        threadStatus: annotation.threadStatus,
        status: annotation.status ?? "ACTIVE",
        kind: "SUGGESTION",
        suggestedText: annotation.suggestedText ?? suggestDraft,
        appliedInVersionNumber: null,
        comments: (annotation.comments ?? []).map((c: ClientComment) => ({ id: c.id, body: c.body, author: c.author })),
      };
      setAnnotations((prev) => (prev.some((x) => x.id === created.id) ? prev : [...prev, created]));
      setSelection(null);
      setPendingBody("");
      setSuggestDraft("");
      setSuggesting(false);
      setFocusedId(created.id);
    }
  }

  const applySuggestion = useCallback(async (annotationId: string) => {
    setApplyError(null);
    const res = await fetch(`/api/annotations/${annotationId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseVersionNumber: versionNumber }),
    });
    if (res.status === 409) { setApplyError("This document changed. Reloading…"); await refetchDetail(); return; }
    if (res.status === 422) { setApplyError("Can't apply — the suggested text's anchor changed. Reject and re-request."); return; }
    if (!res.ok) { setApplyError("Apply failed."); return; }
    await refetchDetail();
  }, [versionNumber, refetchDetail]);
```

Update `refetchDetail`'s annotation mapping and the SSE `annotation.created` mapping to include the three new fields (`kind: a.kind`, `suggestedText: a.suggestedText ?? null`, `appliedInVersionNumber: a.appliedInVersion?.versionNumber ?? null` for refetch; for SSE the published prisma annotation has `kind`/`suggestedText` but no relation, so `appliedInVersionNumber: null`).

In `refetchDetail`:

```typescript
    setAnnotations(
      document.annotations.map((a: ClientAnnotation & { appliedInVersion?: { versionNumber: number } | null }) => ({
        id: a.id, anchorExact: a.anchorExact, anchorPrefix: a.anchorPrefix, anchorSuffix: a.anchorSuffix,
        startOffset: a.startOffset, endOffset: a.endOffset, threadStatus: a.threadStatus, status: a.status,
        kind: a.kind, suggestedText: a.suggestedText ?? null,
        appliedInVersionNumber: a.appliedInVersion?.versionNumber ?? a.appliedInVersionNumber ?? null,
        comments: a.comments,
      }))
    );
```

In the SSE `annotation.created` branch, add `kind: a.kind ?? "COMMENT", suggestedText: a.suggestedText ?? null, appliedInVersionNumber: null,` to the pushed object.

- [ ] **Step 3: Render the suggest-mode UI in the selection card**

In the `{selection && (...)}` Card in `DocumentView`, add a "Suggest edit" toggle button and the proposed-text editor. Replace the selection Card body with:

```tsx
        {selection && (
          <Card className="flex flex-col gap-2 p-3">
            <p className="text-xs text-muted">
              {suggesting ? "Suggesting an edit to" : "Commenting on"}: “{selection.quote.exact.slice(0, 60)}”
            </p>
            {suggesting && (
              <Textarea
                aria-label="proposed text"
                value={suggestDraft}
                onChange={(e) => setSuggestDraft(e.target.value)}
                rows={3}
                placeholder="Proposed replacement text"
              />
            )}
            <Textarea
              aria-label="comment"
              value={pendingBody}
              onChange={(e) => setPendingBody(e.target.value)}
              rows={suggesting ? 2 : 3}
              placeholder={suggesting ? "Why? (optional)" : "Add a comment"}
            />
            <div className="flex flex-wrap gap-2">
              {suggesting ? (
                <Button variant="primary" size="sm" onClick={submitSuggestion}>Suggest</Button>
              ) : (
                <>
                  <Button variant="primary" size="sm" onClick={submitComment}>Comment</Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setSuggesting(true); setSuggestDraft(selection.quote.exact); }}
                  >
                    Suggest edit
                  </Button>
                </>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setSelection(null); setPendingBody(""); setSuggestDraft(""); setSuggesting(false); }}
              >
                Cancel
              </Button>
            </div>
          </Card>
        )}
```

Pass `isOwner`, `onApplySuggestion`, and `applyError` to `CommentSidebar`:

```tsx
        {applyError && <p className="text-xs text-[var(--state-changes)]">{applyError}</p>}
        <CommentSidebar
          annotations={annotations}
          focusedId={focusedId}
          statusById={statusById}
          isOwner={isOwner}
          onSelectThread={setFocusedId}
          onAddComment={addComment}
          onToggleThread={toggleThread}
          onApplySuggestion={applySuggestion}
        />
```

- [ ] **Step 4: Render the suggestion card in `CommentSidebar`**

In `components/CommentSidebar.tsx`, extend both prop bags (`ThreadCard` and `CommentSidebar`) with `isOwner: boolean` and `onApplySuggestion: (annotationId: string) => Promise<void>`, thread them through both `live` and `orphaned` `ThreadCard` renders, and add suggestion rendering inside `ThreadCard`. Insert, right after the existing `{annotation.anchorExact && (...)}` block:

```tsx
      {annotation.kind === "SUGGESTION" && (
        <div data-testid="suggestion" className="flex flex-col gap-1 rounded border border-border p-2 text-xs">
          <span className="font-semibold uppercase text-muted">Suggested edit</span>
          <span className="text-[var(--state-changes)] line-through">{annotation.anchorExact?.slice(0, 120)}</span>
          <span className="text-[var(--state-approved)]">{annotation.suggestedText?.slice(0, 120)}</span>
          {annotation.appliedInVersionNumber != null ? (
            <span className="mt-1 font-medium text-muted">Applied as v{annotation.appliedInVersionNumber}</span>
          ) : isOwner && annotation.threadStatus !== "RESOLVED" ? (
            <div className="mt-1 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={status === "ORPHANED"}
                title={status === "ORPHANED" ? "Can't apply — the anchored text changed" : undefined}
                onClick={(e) => { e.stopPropagation(); onApplySuggestion(annotation.id); }}
              >
                Accept
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onToggleThread(annotation.id, "RESOLVED"); }}
              >
                Reject
              </Button>
              {status === "ORPHANED" && (
                <span className="self-center text-[var(--state-changes)]">anchor text changed</span>
              )}
            </div>
          ) : null}
        </div>
      )}
```

Update the `ThreadCard` prop type and the `CommentSidebar` prop type to include `isOwner` and `onApplySuggestion`, and pass them in both `ThreadCard` usages (the `live.map` and the `orphaned.map`).

- [ ] **Step 5: Typecheck**

Run: `rtk tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
rtk git add components/DocumentView.tsx components/CommentSidebar.tsx app/app/documents/\[id\]/page.tsx
rtk git commit -m "feat(m3-p5): suggestion diff card + suggest-edit mode + owner apply UI"
```

---

### Task 6: e2e — propose, accept, 403, provenance

**Goal:** End-to-end coverage of the reviewer→owner flow, the non-owner guard, and the feedback provenance.

**Files:**
- Create: `tests/e2e/suggestions.spec.ts`

**Acceptance Criteria:**
- [ ] Reviewer (participant) proposes a suggestion; owner accepts → new version contains the suggested text, thread resolved, prior approval dismissed (doc state leaves "Approved").
- [ ] Non-owner `POST /api/annotations/[id]/apply` → 403.
- [ ] Consolidated feedback (owner GET) shows `[applied as v2]`.

**Verify:** `rtk playwright test tests/e2e/suggestions.spec.ts` → pass.

**Steps:**

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/suggestions.spec.ts`:

```typescript
import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<void> {
  const email = `sg-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("reviewer proposes a suggestion, owner accepts → new version + provenance", async ({ browser }) => {
  // Owner A creates a doc and approves it.
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await register(pageA);
  await pageA.goto("/app");
  await pageA.getByLabel("title").fill("Suggest Plan");
  await pageA.getByLabel("markdown").fill("The cloud setup needs review.");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\//);
  const url = pageA.url();
  const id = url.split("/app/documents/")[1];
  await pageA.getByRole("button", { name: "Approve" }).click();
  await expect(pageA.getByTestId("doc-state")).toHaveText("Approved");

  // Reviewer B opens (link-grant) and proposes a suggestion.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await register(pageB);
  await pageB.goto(url);
  await expect(pageB.getByTestId("doc-body")).toContainText("cloud setup");
  await pageB.getByTestId("doc-body").getByText("cloud setup").first().selectText();
  await pageB.getByRole("button", { name: "Suggest edit" }).click();
  await pageB.getByLabel("proposed text").fill("k8s cluster");
  await pageB.getByRole("button", { name: "Suggest" }).click();
  await expect(pageB.getByTestId("suggestion")).toContainText("k8s cluster");

  // B (non-owner) cannot apply → 403.
  const annId = await pageB.evaluate(async (docId) => {
    const r = await fetch(`/api/documents/${docId}`);
    const { document } = await r.json();
    return document.annotations[0].id as string;
  }, id);
  const forbid = await pageB.request.post(`/api/annotations/${annId}/apply`, { data: { baseVersionNumber: 1 } });
  expect(forbid.status()).toBe(403);

  // Owner A sees the suggestion and accepts.
  await expect(pageA.getByTestId("suggestion")).toContainText("k8s cluster", { timeout: 10_000 });
  await pageA.getByRole("button", { name: "Accept" }).click();

  // New version applied: body updated, approval dismissed (state no longer Approved).
  await expect(pageA.getByTestId("doc-body")).toContainText("k8s cluster", { timeout: 10_000 });
  await expect(pageA.getByTestId("doc-state")).not.toHaveText("Approved");
  await expect(pageA.getByTestId("suggestion")).toContainText("Applied as v2");

  // Feedback provenance.
  const fb = await pageA.request.get(`/api/documents/${id}`);
  expect(fb.status()).toBe(200);
  const { document } = await fb.json();
  const applied = document.annotations.find((a: { id: string }) => a.id === annId);
  expect(applied.appliedInVersion?.versionNumber).toBe(2);
  expect(applied.threadStatus).toBe("RESOLVED");

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 2: Run the e2e spec**

Run: `CI=true rtk playwright test tests/e2e/suggestions.spec.ts`
Expected: PASS. (If the dev server/build needs the new migration, ensure `npx prisma migrate deploy` ran for the test DB.)

- [ ] **Step 3: Full suite sanity check**

Run: `rtk vitest run && CI=true rtk playwright test`
Expected: all green (no regressions in versioning/authorization/feedback).

- [ ] **Step 4: Commit**

```bash
rtk git add tests/e2e/suggestions.spec.ts
rtk git commit -m "test(m3-p5): e2e suggestion propose→accept, non-owner 403, provenance"
```

---

## Self-Review

**Spec coverage:**
- D1 (suggestedText, reuse anchor) → Task 1, 2. ✓
- D2 (server computes markdown, delegates to createVersion) → Task 2. ✓
- D3 (owner-only) → Task 3 route `isOwner`; UI gate Task 5. ✓
- D4 (MOVED re-resolve, ORPHANED block) → Task 2 tests + logic. ✓
- D5 (optimistic baseVersionNumber → 409) → Task 2 test + Task 3 mapping. ✓
- D6 (accept → RESOLVED + applied; reject → RESOLVED) → Task 2 (`threadStatus`), Task 5 (Reject = toggle RESOLVED). ✓
- D7 (FK relation) → Task 1. ✓
- D8 (P2 provenance) → Task 4. ✓
- D9 (diff card + one-click accept) → Task 5. ✓
- API surface (create extension, apply route, reject reuse) → Task 3, 5. ✓
- Testing strategy (unit + e2e incl. non-owner 403, applied-in-vN) → Task 2, 4, 6. ✓
- Preserve test hooks → Task 5 AC. ✓

**Placeholder scan:** none — every code step has concrete code.

**Type consistency:** `applySuggestion(userId, annotationId, baseVersionNumber)` consistent across Task 2/3. `OrphanedAnchorError` defined Task 2, imported Task 3. `ClientAnnotation` fields (`kind`, `suggestedText`, `appliedInVersionNumber`) consistent across page/DocumentView/CommentSidebar. `appliedInVersion: { versionNumber }` relation consistent across `lib/documents.ts`, `lib/feedback.ts`, e2e. `FeedbackDetail` exported for the unit test.

**Note on transaction scope:** the spec's API section mentions "one transaction" for span-replacement + createVersion. We deliberately do NOT fork `createVersion`'s internal transaction (D2: it stays the single source of truth). `applySuggestion` calls `createVersion` then updates the annotation — the brief window is acceptable and avoids duplicating re-anchor/approval-dismiss logic. Documented inline in Task 2.
