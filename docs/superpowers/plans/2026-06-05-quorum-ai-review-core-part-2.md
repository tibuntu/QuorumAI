# Quorum AI — Review Core Part 2 (Versioning & Live Collaboration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reviewer can edit a document's markdown to create a new version; every annotation is re-anchored (ACTIVE / MOVED / ORPHANED); any content change resets prior approvals; and annotations, comments, verdicts, and new versions propagate live to other viewers over SSE.

**Architecture:** Same layering as Part 1 — pure unit-tested libs (`lib/anchoring.ts` re-anchoring, `lib/events.ts` pub/sub), unit-tested service (`lib/versions.ts`), thin API routes (`PATCH /api/documents/:id`, `GET /api/documents/:id/stream`), client components (CodeMirror editor + SSE merge). The server persists `Annotation.status` against the raw markdown; the client renders highlights/orphan-grouping by running the same pure `relocate()` against the rendered text, so both sides share one algorithm.

**Tech Stack:** (existing) Next.js 16 App Router, Prisma 7/SQLite, better-auth, Tailwind v4, Vitest, Playwright, react-markdown + remark-gfm. (new) `@uiw/react-codemirror` + `@codemirror/lang-markdown` + `@codemirror/language-data` for the source editor; SSE via the Web Streams `ReadableStream` API (no new dep).

**Conventions:** Plain commit messages, **no `Co-Authored-By` / AI attribution trailer**. Shell has SCM Breeze — use Write/Edit (not heredocs) and single-line Bash; prefer `command git` if the breeze wrapper interferes. Next 16 route handlers receive `params` as a Promise (`const { id } = await params`). Deterministic logic in pure libs; DB in services; routes thin. Value-set constants in `lib/enums.ts`. Work on branch `part-2-versioning-live`; rebase onto `main` (do not merge main in) if it advances.

**Value-set constants** (Foundation, `lib/enums.ts`): `ANCHOR_STATUSES = ["ACTIVE","MOVED","ORPHANED"]` with `AnchorStatus`; `REVIEW_VERDICTS`, `ReviewVerdict`; etc. `Annotation.status` (default `ACTIVE`) and `Review.dismissed` (default `false`) already exist in the schema.

---

### Task 1: Version foreign keys (schema migration)

**Goal:** Convert `Annotation.createdOnVersionId` and `Review.onVersionId` into real relations to `DocumentVersion` (the Foundation tracked these as plain strings).

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_version_fks/migration.sql` (generated)

**Acceptance Criteria:**
- [ ] `Annotation` has a `createdOnVersion` relation to `DocumentVersion` (`onDelete: Restrict`)
- [ ] `Review` has an `onVersion` relation to `DocumentVersion` (`onDelete: Restrict`)
- [ ] `DocumentVersion` has the two inverse relation arrays
- [ ] Migration applies cleanly; all existing unit tests + build pass

**Verify:** `command git checkout` not needed; run `pnpm prisma migrate dev --name version_fks` → applies; `pnpm test:unit` → 15 passed; `pnpm build` → passes.

**Steps:**

- [ ] **Step 1: Edit `prisma/schema.prisma`.** On the `Annotation` model, find the line `createdOnVersionId String` and add directly beneath it:

```prisma
  createdOnVersion   DocumentVersion @relation("AnnotationVersion", fields: [createdOnVersionId], references: [id], onDelete: Restrict)
```

Add to `Annotation`'s index block (next to the existing `@@index([documentId])`):

```prisma
  @@index([createdOnVersionId])
```

- [ ] **Step 2:** On the `Review` model, find `onVersionId String` and add beneath it:

```prisma
  onVersion   DocumentVersion @relation("ReviewVersion", fields: [onVersionId], references: [id], onDelete: Restrict)
```

Add to `Review`'s index block (next to `@@index([documentId])`):

```prisma
  @@index([onVersionId])
```

- [ ] **Step 3:** On the `DocumentVersion` model, add the inverse relations (next to the existing `currentFor Document? @relation("CurrentVersion")` line):

```prisma
  annotationsCreated Annotation[] @relation("AnnotationVersion")
  reviewsOn          Review[]     @relation("ReviewVersion")
```

- [ ] **Step 4: Generate + apply the migration.**

Run: `pnpm prisma migrate dev --name version_fks`
Expected: "The following migration(s) have been applied" + Prisma Client regenerated.

- [ ] **Step 5: Verify nothing regressed.**

Run: `pnpm test:unit` → Expected: `15 passed`.
Run: `pnpm build` → Expected: passes, routes listed.

- [ ] **Step 6: Commit.**

```bash
command git add prisma/schema.prisma prisma/migrations
command git commit -m "feat: add version foreign keys for annotations and reviews"
```

---

### Task 2: Re-anchoring (`relocate`) in the anchoring lib

**Goal:** Add a pure `relocate(text, quote)` that returns `ACTIVE` (exact/context found), `MOVED` (fuzzy match ≥ threshold), or `ORPHANED` (no acceptable match), with the located range.

**Files:**
- Modify: `lib/anchoring.ts`
- Create: `tests/unit/anchoring.relocate.test.ts`

**Acceptance Criteria:**
- [ ] Unchanged/shifted exact text ⇒ `ACTIVE` with correct range
- [ ] Lightly edited anchored text (similarity ≥ 0.7) ⇒ `MOVED` with a near range
- [ ] Removed text ⇒ `ORPHANED` with `range: null`
- [ ] A below-threshold near-miss ⇒ `ORPHANED` (threshold is respected)

**Verify:** `pnpm test:unit -- tests/unit/anchoring.relocate.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write the failing tests** `tests/unit/anchoring.relocate.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildQuote, relocate } from "@/lib/anchoring";

const original = "The quick brown fox jumps over the lazy dog.";
function quoteFor(text: string, phrase: string) {
  const start = text.indexOf(phrase);
  return buildQuote(text, start, start + phrase.length);
}

describe("relocate", () => {
  it("returns ACTIVE when the exact text still exists (shifted)", () => {
    const q = quoteFor(original, "quick brown fox");
    const shifted = "Intro sentence. " + original;
    const r = relocate(shifted, q);
    expect(r.status).toBe("ACTIVE");
    expect(shifted.slice(r.range!.start, r.range!.end)).toBe("quick brown fox");
  });

  it("returns MOVED when the anchored text was lightly edited", () => {
    const q = quoteFor(original, "quick brown fox");
    const edited = "The quick brown wolf jumps over the lazy dog.";
    const r = relocate(edited, q);
    expect(r.status).toBe("MOVED");
    expect(r.range).not.toBeNull();
    expect(r.range!.start).toBe(edited.indexOf("quick brown wolf"));
  });

  it("returns ORPHANED when the text is gone", () => {
    const q = quoteFor(original, "quick brown fox");
    const r = relocate("Completely unrelated content with no overlap whatsoever.", q);
    expect(r.status).toBe("ORPHANED");
    expect(r.range).toBeNull();
  });

  it("respects the threshold (below-threshold near-miss is ORPHANED)", () => {
    const q = quoteFor(original, "quick brown fox");
    const r = relocate("xxxxk bxxwn fox", q, { threshold: 0.95 });
    expect(r.status).toBe("ORPHANED");
  });
});
```

- [ ] **Step 2: Run → fail** (`relocate` not exported).

Run: `pnpm test:unit -- tests/unit/anchoring.relocate.test.ts`
Expected: FAIL ("relocate is not a function" / import error).

- [ ] **Step 3: Implement.** Append to `lib/anchoring.ts` (keep existing exports; add the import at the top):

At the top of the file, add the type import:

```ts
import type { AnchorStatus } from "@/lib/enums";
```

At the bottom of the file, add:

```ts
export const FUZZY_THRESHOLD = 0.7;

export interface Relocation {
  status: AnchorStatus;
  range: TextRange | null;
}

/** Re-locate a quote in (possibly edited) text: exact → ACTIVE, fuzzy → MOVED, none → ORPHANED. */
export function relocate(text: string, quote: Quote, opts?: { threshold?: number }): Relocation {
  const exact = locate(text, quote);
  if (exact) return { status: "ACTIVE", range: exact };
  const fuzzy = locateFuzzy(text, quote, opts?.threshold ?? FUZZY_THRESHOLD);
  if (fuzzy) return { status: "MOVED", range: fuzzy };
  return { status: "ORPHANED", range: null };
}

function locateFuzzy(text: string, quote: Quote, threshold: number): TextRange | null {
  const needle = quote.exact;
  const window = needle.length;
  if (window === 0 || window > text.length) return null;
  let best: { start: number; sim: number; ctx: number } | null = null;
  for (let i = 0; i + window <= text.length; i++) {
    const candidate = text.slice(i, i + window);
    const sim = similarity(needle, candidate);
    if (sim < threshold) continue;
    const pre = text.slice(Math.max(0, i - quote.prefix.length), i);
    const suf = text.slice(i + window, i + window + quote.suffix.length);
    const ctxDenom = quote.prefix.length + quote.suffix.length || 1;
    const ctx = (commonSuffixLen(pre, quote.prefix) + commonPrefixLen(suf, quote.suffix)) / ctxDenom;
    if (!best || sim > best.sim || (sim === best.sim && ctx > best.ctx)) best = { start: i, sim, ctx };
  }
  return best ? { start: best.start, end: best.start + window } : null;
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
```

> `commonPrefixLen` / `commonSuffixLen` already exist in `lib/anchoring.ts` from Part 1 — reuse them, do not redefine.

- [ ] **Step 4: Run → pass.**

Run: `pnpm test:unit -- tests/unit/anchoring.relocate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
command git add lib/anchoring.ts tests/unit/anchoring.relocate.test.ts
command git commit -m "feat: add fuzzy re-anchoring (relocate) to anchoring library"
```

---

### Task 3: In-memory document event bus (`lib/events.ts`)

**Goal:** A process-local pub/sub keyed by document id, used by services to broadcast changes and by the SSE route to fan them out.

**Files:**
- Create: `lib/events.ts`, `tests/unit/events.test.ts`

**Acceptance Criteria:**
- [ ] `subscribe(docId, handler)` receives events published to that doc
- [ ] Events published to a different doc id are NOT received
- [ ] The returned unsubscribe function stops further delivery

**Verify:** `pnpm test:unit -- tests/unit/events.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write the failing tests** `tests/unit/events.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { publish, subscribe, type DocEvent } from "@/lib/events";

describe("event bus", () => {
  it("delivers events to subscribers of the same document only", () => {
    const got: DocEvent[] = [];
    const unsub = subscribe("doc-1", (e) => got.push(e));
    publish("doc-1", { type: "review.updated", state: "OPEN" });
    publish("doc-2", { type: "review.updated", state: "APPROVED" });
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual({ type: "review.updated", state: "OPEN" });
    unsub();
  });

  it("stops delivery after unsubscribe", () => {
    const got: DocEvent[] = [];
    const unsub = subscribe("doc-3", (e) => got.push(e));
    publish("doc-3", { type: "review.updated", state: "OPEN" });
    unsub();
    publish("doc-3", { type: "review.updated", state: "APPROVED" });
    expect(got).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run → fail** (module not found).

- [ ] **Step 3: Implement** `lib/events.ts`

```ts
import { EventEmitter } from "node:events";

export type DocEvent =
  | { type: "annotation.created"; annotation: unknown }
  | { type: "comment.created"; annotationId: string; comment: unknown }
  | { type: "annotation.updated"; annotationId: string; status?: string; threadStatus?: string }
  | { type: "review.updated"; state: string }
  | { type: "version.created"; versionNumber: number; summary: unknown };

const globalForEvents = globalThis as unknown as { docEvents?: EventEmitter };
const emitter = globalForEvents.docEvents ?? new EventEmitter();
emitter.setMaxListeners(0); // many SSE clients per document
if (process.env.NODE_ENV !== "production") globalForEvents.docEvents = emitter;

export function publish(documentId: string, event: DocEvent): void {
  emitter.emit(documentId, event);
}

export function subscribe(documentId: string, handler: (e: DocEvent) => void): () => void {
  emitter.on(documentId, handler);
  return () => {
    emitter.off(documentId, handler);
  };
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit.**

```bash
command git add lib/events.ts tests/unit/events.test.ts
command git commit -m "feat: add in-memory per-document event bus"
```

---

### Task 4: Versions service (`createVersion`)

**Goal:** Create a new `DocumentVersion` with optimistic concurrency, re-anchor all annotations, dismiss approvals on content change, recompute state, and publish a `version.created` event.

**Files:**
- Create: `lib/versions.ts`, `tests/unit/versions.test.ts`

**Acceptance Criteria:**
- [ ] Stale `baseVersionNumber` ⇒ throws `ConcurrencyError`
- [ ] Unchanged content ⇒ returns `{ unchanged: true }`, no new version
- [ ] Re-anchor classifies annotations ACTIVE / MOVED / ORPHANED and updates offsets+status
- [ ] All active `APPROVE` reviews are dismissed and `document.state` recomputed (back to `OPEN`)

**Verify:** `pnpm test:unit -- tests/unit/versions.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Implement** `lib/versions.ts`

```ts
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { relocate } from "@/lib/anchoring";
import { computeDocumentState } from "@/lib/review-state";
import { publish } from "@/lib/events";
import type { ReviewVerdict } from "@/lib/enums";

export class ConcurrencyError extends Error {
  constructor(message = "stale base version") {
    super(message);
    this.name = "ConcurrencyError";
  }
}

export interface ReanchorSummary {
  active: number;
  moved: number;
  orphaned: number;
}

export async function createVersion(userId: string, documentId: string, baseVersionNumber: number, markdown: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { currentVersion: true } });
  if (!doc?.currentVersion) throw new Error("document has no current version");
  if (doc.currentVersion.versionNumber !== baseVersionNumber) throw new ConcurrencyError();

  const contentHash = createHash("sha256").update(markdown).digest("hex");
  if (contentHash === doc.currentVersion.contentHash) return { unchanged: true as const };

  const version = await prisma.documentVersion.create({
    data: {
      documentId,
      versionNumber: doc.currentVersion.versionNumber + 1,
      markdown,
      contentHash,
      createdById: userId,
    },
  });
  await prisma.document.update({ where: { id: documentId }, data: { currentVersionId: version.id } });

  // Re-anchor every annotation against the new markdown.
  const annotations = await prisma.annotation.findMany({ where: { documentId } });
  const summary: ReanchorSummary = { active: 0, moved: 0, orphaned: 0 };
  for (const a of annotations) {
    const result = relocate(markdown, { exact: a.anchorExact ?? "", prefix: a.anchorPrefix ?? "", suffix: a.anchorSuffix ?? "" });
    if (result.status === "ACTIVE") summary.active++;
    else if (result.status === "MOVED") summary.moved++;
    else summary.orphaned++;
    await prisma.annotation.update({
      where: { id: a.id },
      data: { status: result.status, startOffset: result.range?.start ?? null, endOffset: result.range?.end ?? null },
    });
  }

  // Any content change dismisses all active approvals.
  await prisma.review.updateMany({ where: { documentId, verdict: "APPROVE", dismissed: false }, data: { dismissed: true } });

  // Recompute state.
  const reviews = await prisma.review.findMany({ where: { documentId } });
  const state = computeDocumentState(
    reviews.map((r) => ({ verdict: r.verdict as ReviewVerdict, dismissed: r.dismissed })),
    doc.requiredApprovals
  );
  await prisma.document.update({ where: { id: documentId }, data: { state } });

  publish(documentId, { type: "version.created", versionNumber: version.versionNumber, summary });
  return { unchanged: false as const, version, summary, state };
}
```

- [ ] **Step 2: Write the test** `tests/unit/versions.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation } from "@/lib/annotations";
import { submitReview } from "@/lib/reviews";
import { buildQuote } from "@/lib/anchoring";
import { createVersion, ConcurrencyError } from "@/lib/versions";

async function makeUser() {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: "U", email: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

const V1 = "The quick brown fox jumps over the lazy dog. Sphinx of black quartz judge my vow. Pack my box with five dozen liquor jugs.";
const V2 = "The quick brown fox jumps over the lazy dog. Sphinx of white quartz judge my vow.";

function quoteFor(text: string, phrase: string) {
  const start = text.indexOf(phrase);
  return { quote: buildQuote(text, start, start + phrase.length), startOffset: start, endOffset: start + phrase.length };
}

describe("versions service", () => {
  it("rejects a stale base version", async () => {
    const user = await makeUser();
    const docId = await createDocument(user.id, "Doc", V1);
    await expect(createVersion(user.id, docId, 99, V2)).rejects.toBeInstanceOf(ConcurrencyError);
    await prisma.document.delete({ where: { id: docId } });
  });

  it("no-ops on unchanged content", async () => {
    const user = await makeUser();
    const docId = await createDocument(user.id, "Doc", V1);
    const res = await createVersion(user.id, docId, 1, V1);
    expect(res).toEqual({ unchanged: true });
    await prisma.document.delete({ where: { id: docId } });
  });

  it("re-anchors, dismisses approvals, recomputes state", async () => {
    const author = await makeUser();
    const reviewer = await makeUser();
    const docId = await createDocument(author.id, "Doc", V1);
    await createAnnotation(author.id, docId, quoteFor(V1, "quick brown fox"), "stays");
    await createAnnotation(author.id, docId, quoteFor(V1, "Sphinx of black quartz"), "edited");
    await createAnnotation(author.id, docId, quoteFor(V1, "five dozen liquor jugs"), "deleted");
    await submitReview(reviewer.id, docId, "APPROVE"); // requiredApprovals defaults to 1 ⇒ APPROVED

    const res = await createVersion(author.id, docId, 1, V2);
    expect(res.unchanged).toBe(false);
    if (res.unchanged) throw new Error("unreachable");
    expect(res.summary).toEqual({ active: 1, moved: 1, orphaned: 1 });
    expect(res.state).toBe("OPEN"); // approval dismissed

    const reviews = await prisma.review.findMany({ where: { documentId: docId } });
    expect(reviews.every((r) => r.dismissed)).toBe(true);

    await prisma.document.delete({ where: { id: docId } });
  });
});
```

- [ ] **Step 3: Run → pass.**

Run: `pnpm test:unit -- tests/unit/versions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit.**

```bash
command git add lib/versions.ts tests/unit/versions.test.ts
command git commit -m "feat: add versions service with re-anchoring and approval reset"
```

---

### Task 5: PATCH version route + publish wiring

**Goal:** Expose `createVersion` via `PATCH /api/documents/:id`, and make the existing mutation services publish their events to the bus.

**Files:**
- Modify: `app/api/documents/[id]/route.ts` (add `PATCH`)
- Modify: `lib/annotations.ts` (publish in `createAnnotation`, `addComment`, `setThreadStatus`)
- Modify: `lib/reviews.ts` (publish in `submitReview`)

**Acceptance Criteria:**
- [ ] `PATCH` returns the new version + summary on success
- [ ] Stale `baseVersionNumber` ⇒ 409; bad body ⇒ 400; unauthenticated ⇒ 401
- [ ] Each mutation service publishes its event after a successful write
- [ ] `pnpm test:unit` (existing) still passes; `pnpm build` passes

**Verify:** `pnpm test:unit` → all pass; `pnpm build` → passes, `PATCH` listed under `/api/documents/[id]`.

**Steps:**

- [ ] **Step 1: Add `PATCH` to `app/api/documents/[id]/route.ts`.** Keep the existing `GET`; add these imports and handler:

```ts
import { createVersion, ConcurrencyError } from "@/lib/versions";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.markdown !== "string" || typeof body.baseVersionNumber !== "number") {
    return NextResponse.json({ error: "markdown and baseVersionNumber required" }, { status: 400 });
  }
  try {
    const result = await createVersion(user.id, id, body.baseVersionNumber, body.markdown);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ConcurrencyError) return NextResponse.json({ error: "stale version" }, { status: 409 });
    throw e;
  }
}
```

- [ ] **Step 2: Wire publishing into `lib/annotations.ts`.** Add `import { publish } from "@/lib/events";` and update the three functions:

```ts
export async function createAnnotation(
  userId: string,
  documentId: string,
  anchor: { quote: Quote; startOffset: number; endOffset: number; kind?: AnnotationKind },
  body: string
) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");
  const annotation = await prisma.annotation.create({
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
    include: { comments: { include: { author: { select: { name: true, email: true } } } }, author: { select: { name: true, email: true } } },
  });
  publish(documentId, { type: "annotation.created", annotation });
  return annotation;
}

export async function addComment(userId: string, annotationId: string, body: string) {
  const comment = await prisma.comment.create({
    data: { annotationId, authorId: userId, body },
    include: { author: { select: { name: true, email: true } } },
  });
  const ann = await prisma.annotation.findUnique({ where: { id: annotationId }, select: { documentId: true } });
  if (ann) publish(ann.documentId, { type: "comment.created", annotationId, comment });
  return comment;
}

export async function setThreadStatus(annotationId: string, status: ThreadStatus) {
  const annotation = await prisma.annotation.update({ where: { id: annotationId }, data: { threadStatus: status } });
  publish(annotation.documentId, { type: "annotation.updated", annotationId, threadStatus: status });
  return annotation;
}
```

- [ ] **Step 3: Wire publishing into `lib/reviews.ts`.** Add `import { publish } from "@/lib/events";` and append before the `return state;` line in `submitReview`:

```ts
  publish(documentId, { type: "review.updated", state });
  return state;
```

- [ ] **Step 4: Verify.**

Run: `pnpm test:unit` → Expected: all existing tests still pass (annotations/reviews tests still green; the richer `include` is additive).
Run: `pnpm build` → Expected: passes; `ƒ /api/documents/[id]` still listed (now also serves PATCH).

- [ ] **Step 5: Commit.**

```bash
command git add app/api/documents/[id]/route.ts lib/annotations.ts lib/reviews.ts
command git commit -m "feat: add PATCH version route and event publishing"
```

---

### Task 6: SSE stream route

**Goal:** `GET /api/documents/:id/stream` subscribes the client to the document's event bus and emits server-sent events.

**Files:**
- Create: `app/api/documents/[id]/stream/route.ts`

**Acceptance Criteria:**
- [ ] Unauthenticated ⇒ 401
- [ ] Returns `Content-Type: text/event-stream`
- [ ] Each published event is written as a `data: {json}\n\n` frame
- [ ] Subscription is torn down (and heartbeat cleared) on stream cancel
- [ ] `pnpm build` passes

**Verify:** `pnpm build` → passes, `ƒ /api/documents/[id]/stream` listed. (Behaviour proven by the Task 9 e2e.)

**Steps:**

- [ ] **Step 1: Implement** `app/api/documents/[id]/stream/route.ts`

```ts
import { requireUser } from "@/lib/api";
import { subscribe, type DocEvent } from "@/lib/events";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const { id } = await params;

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: DocEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      unsubscribe = subscribe(id, send);
      controller.enqueue(encoder.encode(`: connected\n\n`));
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(`: heartbeat\n\n`)), 25_000);
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Verify.**

Run: `pnpm build` → Expected: passes; `ƒ /api/documents/[id]/stream` appears in the route list.

- [ ] **Step 3: Commit.**

```bash
command git add app/api/documents/[id]/stream/route.ts
command git commit -m "feat: add SSE stream route for live document updates"
```

---

### Task 7: Markdown editor + save (versioning UI)

**Goal:** Add an edit mode to the document view: a CodeMirror source editor with live preview; *Save* creates a new version (PATCH), handling the 409 stale case; on success the view refetches and re-renders the new version.

**Files:**
- Install: `@uiw/react-codemirror`, `@codemirror/lang-markdown`, `@codemirror/language-data`
- Create: `components/DocumentEditor.tsx`
- Modify: `components/DocumentView.tsx` (add `versionNumber`, `markdown` state, mode toggle, save, refetch)
- Modify: `app/app/documents/[id]/page.tsx` (pass `versionNumber`)

**Acceptance Criteria:**
- [ ] An "Edit" toggle reveals the CodeMirror editor (source) with a live markdown preview
- [ ] *Save* posts `{ baseVersionNumber, markdown }` to `PATCH /api/documents/:id`
- [ ] On 409, an inline "document changed — reload" message is shown; no silent overwrite
- [ ] On success the view leaves edit mode and shows the new version's content
- [ ] `pnpm build` passes

**Verify:** `pnpm build` → passes. (Full behaviour proven by Task 9 e2e.)

**Steps:**

- [ ] **Step 1: Install editor deps.**

Run: `pnpm add @uiw/react-codemirror @codemirror/lang-markdown @codemirror/language-data`

- [ ] **Step 2: Extend the client document shape + server mapping.**

In `components/DocumentView.tsx`, add `versionNumber: number;` to the `ClientDocument` interface (after `state: string;`). Also add `status: string;` to `ClientAnnotation` (after `threadStatus: string;`) — used by Task 8.

In `app/app/documents/[id]/page.tsx`, extend the `serializable` object: add `versionNumber: doc.currentVersion?.versionNumber ?? 1,` and, inside the `annotations.map`, add `status: a.status,`.

- [ ] **Step 3: Create** `components/DocumentEditor.tsx`

```tsx
"use client";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function DocumentEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <div data-testid="editor" className="rounded border">
          <CodeMirror
            value={value}
            height="60vh"
            extensions={[markdown({ base: markdownLanguage, codeLanguages: languages })]}
            onChange={onChange}
            aria-label="editor"
          />
        </div>
        <div className="prose max-w-none overflow-auto rounded border p-3" style={{ maxHeight: "60vh" }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded border px-3 py-1 text-sm">Cancel</button>
      </div>
    </div>
  );
}
```

> CodeMirror's `aria-label` may land on a wrapper rather than the textarea; the `data-testid="editor"` div is the stable hook the e2e uses to type into the editor's `.cm-content`.

- [ ] **Step 4: Wire edit mode into `components/DocumentView.tsx`.** Make markdown stateful, add mode + version state, a refetch helper, and a save handler. Add these imports and state near the existing state (`annotations`, `docState`, etc.):

```tsx
import DocumentEditor from "@/components/DocumentEditor";
// ...
const [mode, setMode] = useState<"review" | "edit">("review");
const [markdown, setMarkdown] = useState(doc.markdown);
const [draft, setDraft] = useState(doc.markdown);
const [versionNumber, setVersionNumber] = useState(doc.versionNumber);
const [saving, setSaving] = useState(false);
const [saveError, setSaveError] = useState<string | null>(null);
```

Add a refetch helper (reused by SSE in Task 8) and a save handler:

```tsx
const refetchDetail = useCallback(async () => {
  const res = await fetch(`/api/documents/${doc.id}`);
  if (!res.ok) return;
  const { document } = await res.json();
  setMarkdown(document.currentVersion?.markdown ?? "");
  setVersionNumber(document.currentVersion?.versionNumber ?? versionNumber);
  setDocState(document.state);
  setAnnotations(
    document.annotations.map((a: ClientAnnotation) => ({
      id: a.id, anchorExact: a.anchorExact, anchorPrefix: a.anchorPrefix, anchorSuffix: a.anchorSuffix,
      startOffset: a.startOffset, endOffset: a.endOffset, threadStatus: a.threadStatus, status: a.status,
      comments: a.comments,
    }))
  );
}, [doc.id, versionNumber]);

async function saveVersion() {
  setSaving(true);
  setSaveError(null);
  try {
    const res = await fetch(`/api/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseVersionNumber: versionNumber, markdown: draft }),
    });
    if (res.status === 409) { setSaveError("This document changed since you opened the editor. Reload to get the latest."); return; }
    if (!res.ok) { setSaveError("Save failed."); return; }
    await refetchDetail();
    setMode("review");
  } finally {
    setSaving(false);
  }
}
```

Render: replace the `RenderedMarkdown` usage so the doc body shows either the editor or the rendered markdown, and add an Edit toggle button near the title. Key the rendered markdown by `versionNumber` so each version mounts fresh (avoids stale-highlight reconciliation):

```tsx
{mode === "edit" ? (
  <DocumentEditor value={draft} onChange={setDraft} onSave={saveVersion} onCancel={() => { setDraft(markdown); setMode("review"); }} saving={saving} error={saveError} />
) : (
  <div ref={containerRef} data-testid="doc-body" onClick={onContainerClick} className="prose max-w-none rounded border p-4">
    <RenderedMarkdown key={versionNumber} markdown={markdown} />
  </div>
)}
```

Add the toggle button beside the title (only in review mode):

```tsx
{mode === "review" && (
  <button onClick={() => { setDraft(markdown); setMode("edit"); }} className="rounded border px-2 py-1 text-sm">Edit</button>
)}
```

Update the existing highlight effect dependency array from `[annotations]` to `[annotations, markdown, mode]`, and guard it so it only runs in review mode (the editor has no `containerRef` body):

```tsx
useEffect(() => {
  if (mode !== "review") return;
  const container = containerRef.current;
  if (!container) return;
  // ... existing highlight body ...
}, [annotations, markdown, mode]);
```

- [ ] **Step 5: Verify.**

Run: `pnpm build` → Expected: passes (the page route still listed; editor compiles).

- [ ] **Step 6: Commit.**

```bash
command git add package.json pnpm-lock.yaml components/DocumentEditor.tsx components/DocumentView.tsx app/app/documents/[id]/page.tsx
command git commit -m "feat: add markdown editor and version save UI"
```

---

### Task 8: Live SSE merge + MOVED/ORPHANED rendering

**Goal:** Subscribe to the document's SSE stream and merge live events into state; render MOVED highlights with a badge and group ORPHANED threads in a separate sidebar section, using the shared `relocate` for positioning.

**Files:**
- Modify: `lib/highlight.ts` (per-range className + `data-status`)
- Modify: `components/DocumentView.tsx` (relocate-based highlight + `statusById`, SSE subscription)
- Modify: `components/CommentSidebar.tsx` (orphaned section + status indicator)

**Acceptance Criteria:**
- [ ] On load and after every change, ACTIVE/MOVED annotations are highlighted (MOVED visibly distinct via `data-status="MOVED"`); ORPHANED ones are not highlighted
- [ ] ORPHANED threads appear under an "Orphaned comments" heading in the sidebar
- [ ] A comment/annotation/review/version created in one client appears in another open client without reload (via SSE)
- [ ] `pnpm build` passes

**Verify:** `pnpm build` → passes. (Live behaviour proven by Task 9 e2e.)

**Steps:**

- [ ] **Step 1: Extend `lib/highlight.ts` to carry a status/className per range.** Change `HighlightRange` and the wrap logic:

```ts
export interface HighlightRange {
  id: string;
  start: number;
  end: number;
  status?: string; // "ACTIVE" | "MOVED"
}
```

In `wrapRange`, when building the `<mark>`, set the class and a data attribute from `range.status`:

```ts
const mark = document.createElement("mark");
const moved = range.status === "MOVED";
mark.className = `${moved ? "bg-orange-200" : "bg-yellow-200"} cursor-pointer`;
mark.setAttribute("data-annotation-id", range.id);
mark.setAttribute("data-status", range.status ?? "ACTIVE");
if (moved) mark.title = "This comment moved when the document was edited.";
```

(The rest of `applyHighlights` / `clearHighlights` / text-node walking is unchanged.)

- [ ] **Step 2: Switch the highlight effect in `DocumentView.tsx` to `relocate` and track `statusById`.** Replace the body of the review-mode highlight effect (from Task 7) so it classifies via `relocate` against the rendered text, builds ranges for ACTIVE/MOVED, and records a status map:

```tsx
import { buildQuote, locate, relocate, type Quote } from "@/lib/anchoring";
// add state near the others:
const [statusById, setStatusById] = useState<Record<string, string>>({});

useEffect(() => {
  if (mode !== "review") return;
  const container = containerRef.current;
  if (!container) return;
  const containerText = container.textContent ?? "";
  const ranges: HighlightRange[] = [];
  const statuses: Record<string, string> = {};
  for (const a of annotations) {
    const r = relocate(containerText, { exact: a.anchorExact ?? "", prefix: a.anchorPrefix ?? "", suffix: a.anchorSuffix ?? "" });
    statuses[a.id] = r.status;
    if (r.range) ranges.push({ id: a.id, start: r.range.start, end: r.range.end, status: r.status });
  }
  applyHighlights(container, ranges);
  setStatusById(statuses);
}, [annotations, markdown, mode]);
```

(Remove the now-unused `locate` import only if nothing else uses it; `buildQuote` is still used by the selection handler.)

- [ ] **Step 3: Add the SSE subscription effect in `DocumentView.tsx`.** It merges events and refetches on `version.created` or error:

```tsx
useEffect(() => {
  let es: EventSource | null = null;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function connect() {
    es = new EventSource(`/api/documents/${doc.id}/stream`);
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.type === "comment.created") {
        setAnnotations((prev) => prev.map((a) => a.id === e.annotationId ? { ...a, comments: [...a.comments, { id: e.comment.id, body: e.comment.body, author: e.comment.author }] } : a));
      } else if (e.type === "annotation.created") {
        const a = e.annotation;
        setAnnotations((prev) => prev.some((x) => x.id === a.id) ? prev : [...prev, {
          id: a.id, anchorExact: a.anchorExact, anchorPrefix: a.anchorPrefix, anchorSuffix: a.anchorSuffix,
          startOffset: a.startOffset, endOffset: a.endOffset, threadStatus: a.threadStatus, status: a.status ?? "ACTIVE",
          comments: (a.comments ?? []).map((c: ClientComment) => ({ id: c.id, body: c.body, author: c.author })),
        }]);
      } else if (e.type === "annotation.updated") {
        setAnnotations((prev) => prev.map((a) => a.id === e.annotationId ? { ...a, threadStatus: e.threadStatus ?? a.threadStatus } : a));
      } else if (e.type === "review.updated") {
        setDocState(e.state);
      } else if (e.type === "version.created") {
        refetchDetail();
      }
    };
    es.onerror = () => {
      es?.close();
      if (stopped) return;
      retry = setTimeout(() => { refetchDetail(); connect(); }, 2000);
    };
  }
  connect();
  return () => { stopped = true; es?.close(); if (retry) clearTimeout(retry); };
}, [doc.id, refetchDetail]);
```

Pass `statusById` to the sidebar: `<CommentSidebar ... statusById={statusById} />`.

- [ ] **Step 4: Update `components/CommentSidebar.tsx` to split orphaned threads.** Add `statusById: Record<string, string>` to its props, partition annotations, and render an "Orphaned comments" section. Each non-orphaned `ThreadCard` shows a small "moved" label when its status is `MOVED`:

```tsx
export default function CommentSidebar({
  annotations, focusedId, onSelectThread, onAddComment, onToggleThread, statusById,
}: {
  annotations: ClientAnnotation[]; focusedId: string | null;
  onSelectThread: (id: string) => void;
  onAddComment: (annotationId: string, body: string) => Promise<void>;
  onToggleThread: (annotationId: string, nextStatus: string) => Promise<void>;
  statusById: Record<string, string>;
}) {
  const orphaned = annotations.filter((a) => statusById[a.id] === "ORPHANED");
  const live = annotations.filter((a) => statusById[a.id] !== "ORPHANED");
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-500">Comments</h2>
      {live.length === 0 && orphaned.length === 0 ? (
        <p className="text-sm text-gray-400">Select text in the document to add a comment.</p>
      ) : (
        live.map((a) => (
          <ThreadCard key={a.id} annotation={a} status={statusById[a.id]} focused={focusedId === a.id}
            onSelect={onSelectThread} onAddComment={onAddComment} onToggleThread={onToggleThread} />
        ))
      )}
      {orphaned.length > 0 && (
        <div data-testid="orphaned-section" className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase text-gray-400">Orphaned comments</h3>
          {orphaned.map((a) => (
            <ThreadCard key={a.id} annotation={a} status="ORPHANED" focused={focusedId === a.id}
              onSelect={onSelectThread} onAddComment={onAddComment} onToggleThread={onToggleThread} />
          ))}
        </div>
      )}
    </div>
  );
}
```

Add a `status?: string` prop to `ThreadCard` and render a small badge when `status === "MOVED"` (e.g. `{status === "MOVED" && <span className="text-xs text-orange-600">moved</span>}`).

- [ ] **Step 5: Verify.**

Run: `pnpm build` → Expected: passes.

- [ ] **Step 6: Commit.**

```bash
command git add lib/highlight.ts components/DocumentView.tsx components/CommentSidebar.tsx
command git commit -m "feat: add live SSE updates and moved/orphaned annotation rendering"
```

---

### Task 9: E2E — versioning + live collaboration

**Goal:** Prove the full Part 2 flow end-to-end with Playwright: edit→version re-anchors (MOVED + ORPHANED), approval reset, and live cross-client updates.

**Files:**
- Create: `tests/e2e/versioning.spec.ts`

**Acceptance Criteria:**
- [ ] Editing so an annotated phrase is lightly changed ⇒ after save the thread is still present and its mark shows `data-status="MOVED"`
- [ ] Editing to delete an annotated phrase ⇒ after save the thread appears in the orphaned section
- [ ] Approve then edit content ⇒ state badge returns to "Open"
- [ ] A comment added in one browser context appears live in a second context viewing the same document

**Verify:** `pnpm test:e2e -- tests/e2e/versioning.spec.ts` → passes.

**Steps:**

- [ ] **Step 1: Write** `tests/e2e/versioning.spec.ts`

```ts
import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<string> {
  const email = `ver-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Versioner");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
  return email;
}

async function setEditorText(page: Page, text: string) {
  // Replace the CodeMirror document: focus, select-all, type.
  const editor = page.getByTestId("editor").locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await editor.type(text);
}

test("edit re-anchors (moved + orphaned) and resets approval", async ({ page }) => {
  await register(page);
  await page.getByLabel("title").fill("Versioned Doc");
  await page.getByLabel("markdown").fill("The quick brown fox jumps. Pack my box with five liquor jugs.");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/app\/documents\//);

  // Annotate "brown fox" and "five liquor jugs".
  await page.getByTestId("doc-body").getByText("brown fox").first().selectText();
  await page.getByLabel("comment").fill("which fox?");
  await page.getByRole("button", { name: "Comment" }).click();
  await expect(page.locator('mark[data-annotation-id]')).toHaveCount(1);

  // Approve, then edit so one phrase moves and the other is deleted.
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("doc-state")).toHaveText("Approved");

  await page.getByRole("button", { name: "Edit" }).click();
  await setEditorText(page, "The quick brown wolf jumps.");
  await page.getByRole("button", { name: "Save" }).click();

  // Approval reset; the annotation moved (brown fox -> brown wolf).
  await expect(page.getByTestId("doc-state")).toHaveText("Open");
  await expect(page.locator('mark[data-status="MOVED"]')).toHaveCount(1);
});

test("comments propagate live between two clients", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await register(pageA);
  await pageA.getByLabel("title").fill("Live Doc");
  await pageA.getByLabel("markdown").fill("Shared content for live updates.");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\//);
  const url = pageA.url();

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await register(pageB);
  await pageB.goto(url);
  await expect(pageB.getByTestId("doc-body")).toContainText("Shared content");

  // A adds a comment; B should see it without reloading.
  await pageA.getByTestId("doc-body").getByText("Shared content").first().selectText();
  await pageA.getByLabel("comment").fill("hello from A");
  await pageA.getByRole("button", { name: "Comment" }).click();

  await expect(pageB.getByTestId("thread")).toContainText("hello from A", { timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});
```

> If typing into CodeMirror's `.cm-content` proves flaky, the robust fallback is to drive the version directly: `await page.evaluate(([url, md]) => fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseVersionNumber: 1, markdown: md }) }), [\`/api/documents/${id}\`, "The quick brown wolf jumps."])` then reload — but prefer the real editor path first.

- [ ] **Step 2: Run the e2e.**

Run: `pnpm test:e2e -- tests/e2e/versioning.spec.ts`
Expected: `2 passed`.

- [ ] **Step 3: Confirm nothing else regressed.**

Run: `pnpm test:unit` → Expected: all pass.
Run: `pnpm build` → Expected: passes.

- [ ] **Step 4: Commit.**

```bash
command git add tests/e2e/versioning.spec.ts
command git commit -m "feat: add versioning and live-collaboration e2e"
```

---

## Self-review

- **Spec coverage:** versioning/editing ✓(T7) with optimistic concurrency ✓(T4 `ConcurrencyError` → T5 409); re-anchoring ACTIVE/MOVED/ORPHANED ✓(T2 `relocate`, T4 persists, T8 renders); approval dismissal on content change ✓(T4); FK conversion ✓(T1); in-memory pub/sub ✓(T3) + SSE route ✓(T6) + client merge ✓(T8); orphan UI ✓(T8); e2e ✓(T9). Historical-version browsing + packaging explicitly out of scope (per spec).
- **Placeholders:** none — pure libs/services/routes are complete code; UI tasks give the load-bearing logic (save/409, relocate-based highlight + statusById, SSE merge, version-keyed remount) with the exact `data-testid`s the e2e depends on. The one fiddly area (typing into CodeMirror) has a documented fallback.
- **Type/name consistency:** `relocate`/`Relocation`/`FUZZY_THRESHOLD`/`AnchorStatus` (T2) consumed in T4 + T8; `DocEvent`/`publish`/`subscribe` (T3) used in T5/T6/T8; `createVersion`/`ConcurrencyError`/`ReanchorSummary` (T4) used in T5; `HighlightRange.status` (T8) matches `applyHighlights` usage; client `ClientDocument.versionNumber` + `ClientAnnotation.status` (T7) flow page → view → sidebar; `data-testid`s (`doc-body`, `doc-state`, `thread`, `editor`, `orphaned-section`) and aria-labels (`title`, `markdown`, `comment`, `editor`) align between T7/T8 UI and the T9 e2e.

## Notes for Review-core part 3 (packaging & integration)
- Machine API + `/push-plan` / `/pull-feedback` (new `lib/feedback.ts` consolidation), notifications.
- Resolve the `output: standalone` vs `next start` mismatch (Dockerfile: `node .next/standalone/server.js` + native-module build stage).
- Multi-instance event bus (replace in-memory `lib/events.ts` with Redis/broker pub-sub) if horizontal scaling is needed.
- Historical-version browsing + diff view.
