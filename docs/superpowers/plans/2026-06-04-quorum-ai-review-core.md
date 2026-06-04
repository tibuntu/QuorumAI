# Quorum AI — Review Core (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in user can create a markdown document, open it as a rendered page, select text to attach a comment (anchored highlight), reply in threads, resolve threads, and submit an Approve / Request-changes verdict that drives the document's review state — all in the browser.

**Architecture:** Build on the merged Foundation (Next.js 16, Prisma 7/SQLite, better-auth, the M1 schema). Keep deterministic logic in pure, unit-tested libs (`lib/anchoring.ts`, `lib/review-state.ts`); keep DB operations in unit-tested service modules (`lib/documents.ts`, `lib/annotations.ts`, `lib/reviews.ts`); keep API route handlers thin (auth + parse + delegate). The review view renders markdown with react-markdown and overlays annotation highlights located via the anchoring lib; selection → comment uses the same lib to build a durable text-quote anchor.

**Tech Stack:** (existing) Next.js 16 App Router, Prisma 7/SQLite, better-auth, Tailwind v4, Vitest, Playwright. (new) `react-markdown` + `remark-gfm` for rendering.

**Out of scope (→ Review-core part 2):** in-app markdown **editing**, new **versions**, **cross-version re-anchoring** (fuzzy/Bitap) + orphan UI, and **live SSE** updates. This plan operates on a document's single (v1) version; annotations are created and displayed against that same version, so `locate()` always resolves by exact/context match (no fuzzy step needed yet).

**Conventions:** plain commit messages, **no `Co-Authored-By` / AI attribution trailer**. Shell has SCM Breeze — implementers must use Write/Edit (not heredocs) and single-line Bash. Stay on the feature branch; do not push. Next 16 route handlers receive `params` as a Promise (`const { id } = await params`).

**Value-set constants** live in `lib/enums.ts` (Foundation): `DOCUMENT_STATES`, `ANNOTATION_KINDS`, `ANCHOR_STATUSES`, `THREAD_STATUSES`, `REVIEW_VERDICTS`, with their union types.

---

### Task 1: Anchoring core library

**Goal:** Pure, dependency-free functions to build a text-quote anchor from a selection and to locate that anchor's character range within a body of text (exact match, context-disambiguated when repeated, `null` when absent).

**Files:**
- Create: `lib/anchoring.ts`, `tests/unit/anchoring.test.ts`

**Acceptance Criteria:**
- [ ] `buildQuote(text, start, end)` returns `{ exact, prefix, suffix }` with ≤32 chars of context each side
- [ ] `locate(text, quote)` returns the correct `{ start, end }` for a unique exact match
- [ ] When `exact` appears multiple times, `locate` returns the occurrence whose surrounding text best matches prefix/suffix
- [ ] `locate` returns `null` when `exact` is absent (orphan)

**Verify:** `pnpm test:unit -- tests/unit/anchoring.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write failing tests** `tests/unit/anchoring.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildQuote, locate } from "@/lib/anchoring";

const body = "The cloud setup is fine. The cloud setup needs review. Done.";

describe("anchoring", () => {
  it("builds a quote with bounded context", () => {
    const start = body.indexOf("needs review");
    const q = buildQuote(body, start, start + "needs review".length);
    expect(q.exact).toBe("needs review");
    expect(q.prefix.endsWith("The cloud setup ")).toBe(true);
    expect(q.suffix.startsWith(".")).toBe(true);
  });

  it("locates a unique exact match", () => {
    const q = buildQuote(body, body.indexOf("Done"), body.indexOf("Done") + 4);
    expect(locate(body, q)).toEqual({ start: body.indexOf("Done"), end: body.indexOf("Done") + 4 });
  });

  it("disambiguates repeated text via context", () => {
    const second = body.indexOf("cloud setup", 10);
    const q = buildQuote(body, second, second + "cloud setup".length);
    expect(locate(body, q)).toEqual({ start: second, end: second + "cloud setup".length });
  });

  it("returns null when the text is gone (orphan)", () => {
    expect(locate("totally different text", { exact: "cloud setup", prefix: "", suffix: "" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail** (`module not found`).

- [ ] **Step 3: Implement** `lib/anchoring.ts`

```ts
export interface Quote {
  exact: string;
  prefix: string;
  suffix: string;
}
export interface TextRange {
  start: number;
  end: number;
}

const CONTEXT = 32;

export function buildQuote(text: string, start: number, end: number): Quote {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, Math.min(text.length, end + CONTEXT)),
  };
}

/** Locate the quote in `text`. Exact-unique → that range; repeated → best context match; absent → null. */
export function locate(text: string, quote: Quote): TextRange | null {
  if (!quote.exact) return null;
  const occurrences = indexesOf(text, quote.exact);
  if (occurrences.length === 0) return null;
  if (occurrences.length === 1) {
    return { start: occurrences[0], end: occurrences[0] + quote.exact.length };
  }
  let best: { idx: number; score: number } | null = null;
  for (const idx of occurrences) {
    const pre = text.slice(Math.max(0, idx - quote.prefix.length), idx);
    const suf = text.slice(idx + quote.exact.length, idx + quote.exact.length + quote.suffix.length);
    const score = commonSuffixLen(pre, quote.prefix) + commonPrefixLen(suf, quote.suffix);
    if (!best || score > best.score) best = { idx, score };
  }
  return best ? { start: best.idx, end: best.idx + quote.exact.length } : null;
}

function indexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
```

> Note: cross-version fuzzy re-anchoring (Bitap/edit-distance) + `ORPHANED` status handling is Review-core **part 2**. Part 1 only ever locates within the version the quote was taken from, so exact/context resolution is sufficient.

- [ ] **Step 4: Run → pass.** Commit: `feat: add text-quote anchoring library`.

---

### Task 2: Review-state library

**Goal:** A pure function that derives a document's review state from its (non-dismissed) review verdicts.

**Files:**
- Create: `lib/review-state.ts`, `tests/unit/review-state.test.ts`

**Acceptance Criteria:**
- [ ] Any active `REQUEST_CHANGES` ⇒ `CHANGES_REQUESTED`
- [ ] Active `APPROVE` count ≥ `requiredApprovals` (and no change requests) ⇒ `APPROVED`
- [ ] Otherwise ⇒ `OPEN`
- [ ] Dismissed reviews are ignored

**Verify:** `pnpm test:unit -- tests/unit/review-state.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Tests** `tests/unit/review-state.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { computeDocumentState } from "@/lib/review-state";

describe("computeDocumentState", () => {
  it("is OPEN with no reviews", () => {
    expect(computeDocumentState([], 1)).toBe("OPEN");
  });
  it("is CHANGES_REQUESTED when any active review requests changes", () => {
    expect(computeDocumentState([{ verdict: "APPROVE", dismissed: false }, { verdict: "REQUEST_CHANGES", dismissed: false }], 1)).toBe("CHANGES_REQUESTED");
  });
  it("is APPROVED when approvals meet the threshold and no change requests", () => {
    expect(computeDocumentState([{ verdict: "APPROVE", dismissed: false }, { verdict: "APPROVE", dismissed: false }], 2)).toBe("APPROVED");
  });
  it("ignores dismissed reviews", () => {
    expect(computeDocumentState([{ verdict: "REQUEST_CHANGES", dismissed: true }, { verdict: "APPROVE", dismissed: false }], 1)).toBe("APPROVED");
  });
});
```

- [ ] **Step 2: Implement** `lib/review-state.ts`

```ts
import type { ReviewVerdict, DocumentState } from "@/lib/enums";

export interface ReviewInput {
  verdict: ReviewVerdict;
  dismissed: boolean;
}

export function computeDocumentState(reviews: ReviewInput[], requiredApprovals: number): DocumentState {
  const active = reviews.filter((r) => !r.dismissed);
  if (active.some((r) => r.verdict === "REQUEST_CHANGES")) return "CHANGES_REQUESTED";
  const approvals = active.filter((r) => r.verdict === "APPROVE").length;
  if (approvals >= requiredApprovals) return "APPROVED";
  return "OPEN";
}
```

- [ ] **Step 3: Run → pass.** Commit: `feat: add review-state derivation library`.

---

### Task 3: Documents service + API

**Goal:** Create a document (title + markdown → v1, state OPEN), list documents, and fetch one document with its current version, annotations (+ comments), and reviews. Logic lives in a unit-tested service; routes are thin auth wrappers.

**Files:**
- Create: `lib/api.ts` (auth helper), `lib/documents.ts` (service), `tests/unit/documents.test.ts`
- Create: `app/api/documents/route.ts`, `app/api/documents/[id]/route.ts`

**Acceptance Criteria:**
- [ ] `createDocument(userId, title, markdown)` creates a Document (state `OPEN`, source `WEB`) + v1 DocumentVersion and sets `currentVersionId`
- [ ] `getDocumentDetail(id)` returns the doc, its current markdown, annotations (with comments) and reviews
- [ ] `POST /api/documents` and `GET /api/documents` and `GET /api/documents/:id` return 401 when unauthenticated
- [ ] Service unit test covers create + fetch round-trip

**Verify:** `pnpm test:unit -- tests/unit/documents.test.ts` → passes; `pnpm build` passes.

**Steps:**

- [ ] **Step 1: Auth helper** `lib/api.ts`

```ts
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}
```

- [ ] **Step 2: Service** `lib/documents.ts`

```ts
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

export async function createDocument(userId: string, title: string, markdown: string) {
  const doc = await prisma.document.create({
    data: { title, ownerId: userId, state: "OPEN", source: "WEB" },
  });
  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: 1,
      markdown,
      contentHash: createHash("sha256").update(markdown).digest("hex"),
      createdById: userId,
    },
  });
  await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  return doc.id;
}

export async function listDocuments() {
  return prisma.document.findMany({
    orderBy: { updatedAt: "desc" },
    include: { owner: { select: { name: true, email: true } } },
  });
}

export async function getDocumentDetail(id: string) {
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      currentVersion: true,
      owner: { select: { name: true, email: true } },
      annotations: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { name: true, email: true } },
          comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, email: true } } } },
        },
      },
      reviews: { include: { reviewer: { select: { name: true, email: true } } } },
    },
  });
  return doc;
}
```

- [ ] **Step 3: Service test** `tests/unit/documents.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument, getDocumentDetail, listDocuments } from "@/lib/documents";

async function makeUser() {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${Date.now()}-${Math.round(Math.random()*1e6)}`, name: "U", email: `u-${Date.now()}-${Math.round(Math.random()*1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("documents service", () => {
  it("creates a doc with v1 and fetches detail", async () => {
    const user = await makeUser();
    const id = await createDocument(user.id, "Plan", "# Heading\n\ncloud setup");
    const detail = await getDocumentDetail(id);
    expect(detail?.state).toBe("OPEN");
    expect(detail?.currentVersion?.markdown).toContain("cloud setup");
    const all = await listDocuments();
    expect(all.find((d) => d.id === id)).toBeTruthy();
    await prisma.document.delete({ where: { id } });
  });
});
```

> Note: the test supplies `createdAt`/`updatedAt` for the bare `prisma.user.create` because the better-auth User model has no DB defaults on those (Foundation note). Avoid `Math.random()` only in Workflow scripts — this is a normal test file, so it's fine.

- [ ] **Step 4: Routes**

`app/api/documents/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { createDocument, listDocuments } from "@/lib/documents";

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || typeof body.markdown !== "string") {
    return NextResponse.json({ error: "title and markdown required" }, { status: 400 });
  }
  const id = await createDocument(user.id, body.title, body.markdown);
  return NextResponse.json({ id }, { status: 201 });
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ documents: await listDocuments() });
}
```

`app/api/documents/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { getDocumentDetail } from "@/lib/documents";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const doc = await getDocumentDetail(id);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ document: doc });
}
```

- [ ] **Step 5:** `pnpm test:unit` + `pnpm build` pass. Commit: `feat: add documents service and API`.

---

### Task 4: Annotations + comments service + API

**Goal:** Create an annotation (a text-quote anchor + first comment) on a document, reply to its thread, and resolve/reopen the thread.

**Files:**
- Create: `lib/annotations.ts`, `tests/unit/annotations.test.ts`
- Create: `app/api/documents/[id]/annotations/route.ts`, `app/api/annotations/[id]/comments/route.ts`, `app/api/annotations/[id]/route.ts`

**Acceptance Criteria:**
- [ ] `createAnnotation(userId, docId, {quote, startOffset, endOffset, kind}, body)` creates an Annotation (status ACTIVE, threadStatus OPEN) + first Comment, stamped with the doc's current version id
- [ ] `addComment(userId, annotationId, body)` appends a comment
- [ ] `setThreadStatus(annotationId, status)` toggles OPEN/RESOLVED
- [ ] Routes 401 when unauthenticated; 400 on invalid body
- [ ] Service test covers create → reply → resolve

**Verify:** `pnpm test:unit -- tests/unit/annotations.test.ts` → passes; `pnpm build` passes.

**Steps:**

- [ ] **Step 1: Service** `lib/annotations.ts`

```ts
import { prisma } from "@/lib/db";
import type { Quote } from "@/lib/anchoring";
import type { AnnotationKind, ThreadStatus } from "@/lib/enums";

export async function createAnnotation(
  userId: string,
  documentId: string,
  anchor: { quote: Quote; startOffset: number; endOffset: number; kind?: AnnotationKind },
  body: string
) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");
  return prisma.annotation.create({
    data: {
      documentId,
      createdOnVersionId: doc.currentVersionId,
      kind: anchor.kind ?? "COMMENT",
      anchorExact: anchor.quote.exact,
      anchorPrefix: anchor.quote.prefix,
      anchorSuffix: anchor.quote.suffix,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      authorId: userId,
      comments: { create: { authorId: userId, body } },
    },
    include: { comments: true },
  });
}

export async function addComment(userId: string, annotationId: string, body: string) {
  return prisma.comment.create({ data: { annotationId, authorId: userId, body } });
}

export async function setThreadStatus(annotationId: string, status: ThreadStatus) {
  return prisma.annotation.update({ where: { id: annotationId }, data: { threadStatus: status } });
}
```

- [ ] **Step 2: Service test** `tests/unit/annotations.test.ts` — create a user + doc (via `createDocument`), then `createAnnotation` with a quote built from the markdown, `addComment`, `setThreadStatus("RESOLVED")`, and assert the annotation has 2 comments and threadStatus RESOLVED. (Mirror the user-creation helper from Task 3's test, including `createdAt`/`updatedAt`.)

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation, addComment, setThreadStatus } from "@/lib/annotations";
import { buildQuote } from "@/lib/anchoring";

describe("annotations service", () => {
  it("creates, replies, resolves", async () => {
    const now = new Date();
    const user = await prisma.user.create({ data: { id: `u-${Date.now()}`, name: "U", email: `u-${Date.now()}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
    const md = "The cloud setup needs review.";
    const docId = await createDocument(user.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    const ann = await createAnnotation(user.id, docId, { quote: buildQuote(md, start, start + "cloud setup".length), startOffset: start, endOffset: start + 11 }, "infra concern");
    await addComment(user.id, ann.id, "agree");
    await setThreadStatus(ann.id, "RESOLVED");
    const loaded = await prisma.annotation.findUnique({ where: { id: ann.id }, include: { comments: true } });
    expect(loaded?.comments).toHaveLength(2);
    expect(loaded?.threadStatus).toBe("RESOLVED");
    await prisma.document.delete({ where: { id: docId } });
  });
});
```

- [ ] **Step 3: Routes** (thin; all `requireUser`-guarded, 401/400 as in Task 3):

`app/api/documents/[id]/annotations/route.ts` → POST: parse `{ quote, startOffset, endOffset, kind?, body }`, call `createAnnotation`, return the created annotation (201).
`app/api/annotations/[id]/comments/route.ts` → POST: parse `{ body }`, call `addComment` (201).
`app/api/annotations/[id]/route.ts` → PATCH: parse `{ threadStatus }` (validate against `THREAD_STATUSES`), call `setThreadStatus`.

Each handler: `const user = await requireUser(); if (!user) return 401;` then `const { id } = await params;` then validate body (400 on bad input) then delegate and `NextResponse.json(...)`.

- [ ] **Step 4:** `pnpm test:unit` + `pnpm build` pass. Commit: `feat: add annotations and comments service and API`.

---

### Task 5: Reviews service + API (verdict → state)

**Goal:** Submitting a review verdict records it and recomputes the document's `state` via the review-state lib. A user's prior verdict on a document is replaced (one active verdict per reviewer).

**Files:**
- Create: `lib/reviews.ts`, `tests/unit/reviews.test.ts`
- Create: `app/api/documents/[id]/reviews/route.ts`

**Acceptance Criteria:**
- [ ] `submitReview(userId, docId, verdict)` upserts the reviewer's verdict for the doc's current version and updates `document.state` from `computeDocumentState`
- [ ] An author submitting REQUEST_CHANGES then another user APPROVE (requiredApprovals 1) ⇒ state `CHANGES_REQUESTED` (change request dominates)
- [ ] Two APPROVEs with requiredApprovals 1 ⇒ `APPROVED`
- [ ] Route 401 when unauthenticated; 400 on invalid verdict

**Verify:** `pnpm test:unit -- tests/unit/reviews.test.ts` → passes; `pnpm build` passes.

**Steps:**

- [ ] **Step 1: Service** `lib/reviews.ts`

```ts
import { prisma } from "@/lib/db";
import { computeDocumentState } from "@/lib/review-state";
import type { ReviewVerdict } from "@/lib/enums";

export async function submitReview(userId: string, documentId: string, verdict: ReviewVerdict) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true, requiredApprovals: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");

  // One active verdict per reviewer for the current version: replace any prior.
  await prisma.review.deleteMany({ where: { documentId, reviewerId: userId } });
  await prisma.review.create({ data: { documentId, reviewerId: userId, verdict, onVersionId: doc.currentVersionId } });

  const reviews = await prisma.review.findMany({ where: { documentId } });
  const state = computeDocumentState(reviews.map((r) => ({ verdict: r.verdict as ReviewVerdict, dismissed: r.dismissed })), doc.requiredApprovals);
  await prisma.document.update({ where: { id: documentId }, data: { state } });
  return state;
}
```

- [ ] **Step 2: Service test** `tests/unit/reviews.test.ts` — create a doc + two users; `submitReview(u1, doc, "REQUEST_CHANGES")` then `submitReview(u2, doc, "APPROVE")` ⇒ expect `CHANGES_REQUESTED`; then `submitReview(u1, doc, "APPROVE")` ⇒ expect `APPROVED`. (User-creation helper as before.)

- [ ] **Step 3: Route** `app/api/documents/[id]/reviews/route.ts` → POST: `requireUser` (401), `const { id } = await params`, parse `{ verdict }`, validate `REVIEW_VERDICTS.includes(verdict)` (400), call `submitReview`, return `{ state }`.

- [ ] **Step 4:** `pnpm test:unit` + `pnpm build` pass. Commit: `feat: add reviews service and API with state aggregation`.

---

### Task 6: Documents list + create UI

**Goal:** The authenticated home (`/app`) lists all documents (open instance) with their state, and a "New document" form (title + markdown) creates one and navigates to it.

**Files:**
- Create: `components/NewDocumentForm.tsx`
- Modify: `app/app/page.tsx` (replace the placeholder)

**Acceptance Criteria:**
- [ ] `/app` lists existing documents (title, owner, state badge), each linking to `/app/documents/:id`
- [ ] The form posts to `POST /api/documents` and routes to the new doc on success
- [ ] Empty state shown when there are no documents

**Verify:** covered by Task 7's Playwright e2e (create flow). Also `pnpm build` passes.

**Steps:**

- [ ] **Step 1:** `app/app/page.tsx` becomes a server component that fetches via the service (`listDocuments()` directly — it's server-side) and renders the list + `<NewDocumentForm />`. Show owner name/email and a `state` badge. Each item links to `/app/documents/${doc.id}`.

- [ ] **Step 2:** `components/NewDocumentForm.tsx` (client): controlled `title` input + `markdown` textarea; on submit `fetch("/api/documents", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({title, markdown})})`; on 201 read `{id}` and `router.push(\`/app/documents/${id}\`)`; show inline error on failure. Give the textarea `aria-label="markdown"`, the title `aria-label="title"`, and the submit button text "Create document".

- [ ] **Step 3:** `pnpm build` passes. Commit: `feat: add documents list and create UI`.

---

### Task 7: Document review view (annotate + comment + verdict) + e2e

**Goal:** Open a document at `/app/documents/:id`: render its markdown, let the user select text to add a comment (creating an anchored highlight), show all annotations as highlights + a comment sidebar with threaded replies and resolve, and provide Approve / Request-changes buttons that update the state. Proven end-to-end with Playwright.

**Files:**
- Create: `app/app/documents/[id]/page.tsx` (server: load detail, pass to client), `components/DocumentView.tsx` (client), `components/CommentSidebar.tsx` (client), `lib/highlight.ts` (client DOM helper)
- Create: `tests/e2e/review.spec.ts`

**Acceptance Criteria:**
- [ ] The document markdown renders (react-markdown + remark-gfm)
- [ ] Selecting text and submitting a comment creates an annotation; the selected text shows a highlight and the comment appears in the sidebar
- [ ] Replying adds to the thread; resolving marks the thread resolved
- [ ] Clicking "Request changes" sets the document state to "Changes requested"; "Approve" sets "Approved"
- [ ] e2e covers: create doc → open → select text → comment → see highlight + thread → request changes → state badge updates

**Verify:** `pnpm test:e2e -- tests/e2e/review.spec.ts` → 1 passed.

**Steps:**

- [ ] **Step 1: Install rendering deps:** `pnpm add react-markdown remark-gfm`.

- [ ] **Step 2: Server page** `app/app/documents/[id]/page.tsx` — `const { id } = await params`; `const doc = await getDocumentDetail(id)`; if null → `notFound()`; render `<DocumentView doc={serializableDoc} />` (map Prisma dates to strings / pass the fields the client needs: id, title, state, markdown = currentVersion.markdown, annotations[{id, anchorExact, anchorPrefix, anchorSuffix, startOffset, endOffset, threadStatus, comments[{id, body, author}]}]).

- [ ] **Step 3: Client `components/DocumentView.tsx`** — the heart. Structure:
  - State: `annotations` (seeded from props), `selection` (current `{quote, startOffset, endOffset}` or null), `pendingBody`.
  - Render two columns: left = the rendered doc in a `ref`'d container; right = `<CommentSidebar/>` + a `<ReviewBar/>` (Approve / Request changes buttons + a state badge).
  - Rendered doc: `<div ref={containerRef}><ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown></div>`.
  - **Selection → quote:** on the container's `onMouseUp`, read `window.getSelection()`. If non-empty and within the container, compute the selected text's character offsets **within `containerRef.current.textContent`** (use a Range from container start to selection start to measure `start`; `end = start + selected.length`). Build the quote via `buildQuote(containerText, start, end)`. Store as `selection` and reveal an "Add comment" box.
  - **Submit comment:** POST `/api/documents/${id}/annotations` with `{ quote, startOffset, endOffset, body }`; on success append the returned annotation to state and clear the selection.
  - **Render highlights:** after render and whenever `annotations` change, for each annotation call `locate(containerText, {exact,prefix,suffix})`; if found, wrap that text range in a `<mark data-annotation-id>` via the `lib/highlight.ts` helper (text-node walking over the container). Clicking a mark focuses its thread in the sidebar; clicking a sidebar card scrolls/flashes its mark.
  - Provide stable `data-testid`s: container `data-testid="doc-body"`, add-comment textarea `aria-label="comment"`, submit button "Comment", each thread `data-testid="thread"`, state badge `data-testid="doc-state"`.

- [ ] **Step 4: `lib/highlight.ts`** — a client helper `applyHighlights(container: HTMLElement, ranges: {id: string; start: number; end: number}[])` that walks text nodes accumulating offset, and wraps the `[start,end)` slice of each range in a `<mark class="bg-yellow-200" data-annotation-id={id}>`. (Idempotent: clear prior `<mark>`s first by unwrapping, or re-render the markdown then re-apply.) **Implementer note:** this is the one genuinely fiddly DOM routine — keep it isolated and covered by the e2e; adapt to react-markdown's emitted DOM. A simpler acceptable MVP fallback: render highlights only for ranges that fall within a single text node, and list any that don't in the sidebar without an inline mark (document this if you take the fallback).

- [ ] **Step 5: `components/CommentSidebar.tsx`** — lists annotation threads (each: highlighted quote snippet, comments with author + body, a reply box → POST `/api/annotations/${annId}/comments`, and a "Resolve"/"Reopen" toggle → PATCH `/api/annotations/${annId}` with `{threadStatus}`). Resolved threads visually dimmed.

- [ ] **Step 6: ReviewBar** (inline in DocumentView or its own component) — "Approve" and "Request changes" buttons → POST `/api/documents/${id}/reviews` with `{verdict}`; on success update the `data-testid="doc-state"` badge text from the returned `{state}` (map `OPEN`→"Open", `CHANGES_REQUESTED`→"Changes requested", `APPROVED`→"Approved").

- [ ] **Step 7: e2e** `tests/e2e/review.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("create, annotate, comment, request changes", async ({ page }) => {
  const email = `rev-${Date.now()}@example.com`;
  // register
  await page.goto("/register");
  await page.getByLabel("name").fill("Reviewer");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);

  // create a doc
  await page.getByLabel("title").fill("Infra Plan");
  await page.getByLabel("markdown").fill("The cloud setup needs review before launch.");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/app\/documents\//);

  // select the phrase "cloud setup" in the rendered body
  await page.getByTestId("doc-body").getByText("cloud setup").first().selectText();
  await page.getByLabel("comment").fill("which cloud provider?");
  await page.getByRole("button", { name: "Comment" }).click();

  // thread appears with the comment, and a highlight exists
  await expect(page.getByTestId("thread")).toContainText("which cloud provider?");
  await expect(page.locator("mark[data-annotation-id]")).toHaveCount(1);

  // request changes → state badge updates
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(page.getByTestId("doc-state")).toHaveText("Changes requested");
});
```

- [ ] **Step 8:** Run the e2e; confirm `pnpm test:unit` + `pnpm build` still pass. Commit: `feat: add document review view with annotation, threads, and verdicts`.

---

## Self-review
- **Spec coverage:** anchoring ✓(T1), state derivation ✓(T2), documents create/list/get ✓(T3), annotations+comments ✓(T4), reviews→state ✓(T5), list/create UI ✓(T6), rendered annotate+thread+verdict view + e2e ✓(T7). Editing/versioning/re-anchoring/SSE explicitly deferred to part 2.
- **Placeholders:** none in libs/services/routes (complete code). UI tasks give component contracts + the load-bearing logic (selection→quote→POST, locate→highlight, thread/verdict wiring) with explicit `data-testid`s the e2e depends on; the one fiddly DOM routine (`lib/highlight.ts`) is isolated with a documented MVP fallback.
- **Type/name consistency:** `buildQuote`/`locate`/`Quote`/`TextRange` (T1) reused in T4/T7; `computeDocumentState`/`ReviewInput` (T2) used in T5; service names (`createDocument`, `getDocumentDetail`, `createAnnotation`, `addComment`, `setThreadStatus`, `submitReview`) consistent across service/route/UI; `data-testid`s (`doc-body`, `doc-state`, `thread`) and aria-labels (`title`, `markdown`, `comment`) match between T6/T7 UI and the e2e.

## Notes for Review-core part 2
- In-app editing (CodeMirror source editor) → new `DocumentVersion` via a `PATCH /api/documents/:id` (carry `baseVersion` for optimistic concurrency).
- On new version: re-anchor every annotation against the new markdown (add the fuzzy/Bitap step to `lib/anchoring.ts`), set `status` ACTIVE/MOVED/ORPHANED, and **dismiss prior approvals** on non-editorial diffs (wire `Review.dismissed`).
- Convert `Annotation.createdOnVersionId` / `Review.onVersionId` to real FKs (tracked from Foundation).
- Live updates: add `GET /api/documents/:id/stream` (SSE) broadcasting annotation/comment/review events; subscribe in `DocumentView`.
- Then the Integration & packaging plan: machine API + `/push-plan`/`/pull-feedback` (consumes a new `lib/feedback.ts` consolidation), notifications, Dockerfile (re-add `output: standalone` + `node .next/standalone/server.js` + native-module build stage).
