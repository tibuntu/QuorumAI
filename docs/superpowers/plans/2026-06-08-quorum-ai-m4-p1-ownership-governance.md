# M4 · P1 — Ownership Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a document owner from issuing review verdicts on their own document, and let an owner hard-delete a document they own.

**Architecture:** Two independent server-side ownership rules with thin UI. The verdict block is a 403 guard in the reviews route plus hiding the owner's verdict controls. Deletion is a transactional ordered delete in `lib/documents.ts` (works around `onDelete: Restrict` FKs on `DocumentVersion`), exposed via a new `DELETE` route, surfaced by an owner-only Delete button + confirm modal.

**Tech Stack:** Next.js App Router route handlers, Prisma (SQLite), better-auth session (`requireUser`), Vitest, React client component.

**Design spec:** `docs/superpowers/specs/2026-06-08-quorum-ai-m4-p1-ownership-governance-design.md`

**Worktree/env notes (carried from M1–M3):** create an isolated worktree off `main` at execution time; pnpm v11 needs `CI=true` on script runs; copy `.env.example`→`.env` (set `BETTER_AUTH_SECRET`), `mkdir -p data`, run `prisma migrate deploy` so the unit suite's SQLite file exists; free port 3000 before `pnpm test:e2e`; preserve existing `data-testid`/`aria-label`/button-name hooks; rebase onto `main` (don't merge main in).

---

### Task 1: Block owner verdicts (server guard + hide verdict UI)

**Goal:** A document owner receives 403 when POSTing a review verdict on their own document, and the verdict controls are not shown to the owner in the UI.

**Files:**
- Modify: `app/api/documents/[id]/reviews/route.ts` (add owner 403 after the participant check)
- Modify: `components/DocumentView.tsx` (wrap verdict controls in `!isOwner`)
- Test: `tests/unit/reviews.owner-block.test.ts`

**Acceptance Criteria:**
- [ ] Owner POST to `/api/documents/[id]/reviews` → 403 `{ error: "owners cannot review their own document" }`.
- [ ] Non-owner participant POST → unchanged (verdict recorded, 200).
- [ ] Owner is still a participant (GET/annotation flows unaffected).
- [ ] Verdict controls (Approve / Request changes) are absent from the DOM when `isOwner` is true.

**Verify:** `CI=true pnpm exec vitest run tests/unit/reviews.owner-block.test.ts` → PASS; full suite still green.

**Steps:**

- [ ] **Step 1: Write the failing test.** Model it on the existing review tests (look at `tests/unit/` for a review/integration test that seeds a user + document via `createDocument` and calls `submitReview` or the route). The test seeds an owner and a second participant, then asserts the route guard.

```ts
// tests/unit/reviews.owner-block.test.ts
import { describe, expect, test, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createDocument } from "@/lib/documents";
import { isOwner, isParticipant } from "@/lib/authz";

// Helper: create a user row directly (mirror how other unit tests create users —
// check an existing test for the exact better-auth/user creation helper and reuse it).
async function makeUser(email: string) {
  return prisma.user.create({ data: { email, name: email.split("@")[0] } });
}

describe("owner verdict block", () => {
  beforeEach(async () => {
    // mirror existing tests' cleanup ordering; deleteMany on the same tables they reset
    await prisma.review.deleteMany();
    await prisma.documentParticipant.deleteMany();
    await prisma.document.deleteMany();
    await prisma.user.deleteMany();
  });

  test("owner is a participant of their own document", async () => {
    const owner = await makeUser("owner@example.com");
    const id = await createDocument(owner.id, "Plan", "# hi");
    expect(await isParticipant(owner.id, id)).toBe(true);
    expect(await isOwner(owner.id, id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it passes for the participant assertion** (this documents current behavior; the guard is enforced at the route). Run: `CI=true pnpm exec vitest run tests/unit/reviews.owner-block.test.ts` → PASS. This confirms the owner IS a participant, which is exactly why the explicit owner block is needed.

- [ ] **Step 3: Add the owner guard in the route.** In `app/api/documents/[id]/reviews/route.ts`, immediately after the existing `isParticipant` check (the `404` line), add:

```ts
import { isOwner, isParticipant } from "@/lib/authz"; // ensure isOwner is imported
// ...inside POST, after the isParticipant 404 guard:
if (await isOwner(user.id, id)) {
  return NextResponse.json({ error: "owners cannot review their own document" }, { status: 403 });
}
```

- [ ] **Step 4: Add a route-level test asserting 403 for owner / 200 for non-owner.** If the existing review tests call the route handler directly (importing `POST`), follow that pattern; otherwise test `submitReview` is reachable only for non-owners by asserting the guard via a thin call to the route's `POST` with a mocked `requireUser`. Concretely, extend the test file:

```ts
import { POST } from "@/app/api/documents/[id]/reviews/route";
import * as authn from "@/lib/auth-helpers"; // wherever requireUser lives — confirm the module path
import { vi } from "vitest";

function req(body: unknown) {
  return new Request("http://t/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("owner verdict is rejected with 403", async () => {
  const owner = await makeUser("owner@example.com");
  const id = await createDocument(owner.id, "Plan", "# hi");
  vi.spyOn(authn, "requireUser").mockResolvedValue({ id: owner.id, email: owner.email } as never);
  const res = await POST(req({ verdict: "APPROVE" }), { params: Promise.resolve({ id }) });
  expect(res.status).toBe(403);
});

test("participant verdict is accepted", async () => {
  const owner = await makeUser("owner@example.com");
  const reviewer = await makeUser("rev@example.com");
  const id = await createDocument(owner.id, "Plan", "# hi");
  await prisma.documentParticipant.create({ data: { documentId: id, userId: reviewer.id } });
  vi.spyOn(authn, "requireUser").mockResolvedValue({ id: reviewer.id, email: reviewer.email } as never);
  const res = await POST(req({ verdict: "APPROVE" }), { params: Promise.resolve({ id }) });
  expect(res.status).toBe(200);
});
```

  Adjust `requireUser`'s import path and the `params` signature to match the actual route (check the route's function signature — App Router passes `{ params }`). Run: `CI=true pnpm exec vitest run tests/unit/reviews.owner-block.test.ts` → first owner-403 test FAILS before Step 3's edit, PASSES after.

- [ ] **Step 5: Hide verdict controls for the owner in `components/DocumentView.tsx`.** Locate the verdict-submission JSX (the Approve / Request-changes buttons — search for the verdict POST `fetch(`/api/documents/${doc.id}/reviews`)` and the buttons that trigger it). Wrap that block in `{!isOwner && ( ... )}`. If a helper renders them, pass `isOwner` down. Leave annotation/comment creation untouched.

- [ ] **Step 6: Verify build + lint + types.** Run: `CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint` → clean.

- [ ] **Step 7: Commit.**

```bash
git add app/api/documents/[id]/reviews/route.ts components/DocumentView.tsx tests/unit/reviews.owner-block.test.ts
git commit -m "feat(m4-p1): block owner from reviewing own document (403 + hide verdict UI)"
```

---

### Task 2: `deleteDocument` service with transactional cascade

**Goal:** A pure service function deletes a document and all dependents in dependency order, succeeding even when annotations/reviews reference versions via `onDelete: Restrict`.

**Files:**
- Modify: `lib/documents.ts` (add `deleteDocument`)
- Test: `tests/unit/documents.delete.test.ts`

**Acceptance Criteria:**
- [ ] `deleteDocument(id)` removes the document and leaves zero orphan rows in `documentVersion`, `annotation`, `comment`, `review`, `documentParticipant`, `notification`.
- [ ] Succeeds for a document that has an **applied suggestion** (exercises `Annotation.appliedInVersion` Restrict) and a **review on a version** (exercises `Review.onVersion` Restrict).
- [ ] Runs in a single `$transaction`.

**Verify:** `CI=true pnpm exec vitest run tests/unit/documents.delete.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test.** Seed a fully-populated document, then assert it deletes cleanly.

```ts
// tests/unit/documents.delete.test.ts
import { describe, expect, test, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createDocument, deleteDocument } from "@/lib/documents";

async function makeUser(email: string) {
  return prisma.user.create({ data: { email, name: email.split("@")[0] } });
}

describe("deleteDocument", () => {
  beforeEach(async () => {
    await prisma.comment.deleteMany();
    await prisma.review.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.documentParticipant.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    await prisma.user.deleteMany();
  });

  test("removes a fully-populated document with no orphans", async () => {
    const owner = await makeUser("owner@example.com");
    const id = await createDocument(owner.id, "Plan", "# v1 body");
    const v1 = await prisma.documentVersion.findFirstOrThrow({ where: { documentId: id } });

    // annotation created on v1, with a comment
    const ann = await prisma.annotation.create({
      data: {
        documentId: id, createdOnVersionId: v1.id,
        anchorExact: "v1", anchorPrefix: "# ", anchorSuffix: " body",
        startOffset: 2, endOffset: 4, kind: "COMMENT", threadStatus: "OPEN", status: "ACTIVE",
        authorId: owner.id,
      },
    });
    await prisma.comment.create({ data: { annotationId: ann.id, authorId: owner.id, body: "hi" } });
    // a review tied to v1 (Review.onVersion Restrict)
    await prisma.review.create({ data: { documentId: id, reviewerId: owner.id, onVersionId: v1.id, verdict: "COMMENT" } });
    // an annotation marked applied in v1 (Annotation.appliedInVersion Restrict)
    await prisma.annotation.update({ where: { id: ann.id }, data: { appliedInVersionId: v1.id } });

    await deleteDocument(id);

    expect(await prisma.document.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.documentVersion.count({ where: { documentId: id } })).toBe(0);
    expect(await prisma.annotation.count({ where: { documentId: id } })).toBe(0);
    expect(await prisma.comment.count({ where: { annotationId: ann.id } })).toBe(0);
    expect(await prisma.review.count({ where: { documentId: id } })).toBe(0);
    expect(await prisma.documentParticipant.count({ where: { documentId: id } })).toBe(0);
  });
});
```

  **Note:** confirm the exact field names against `prisma/schema.prisma` (e.g. `createdOnVersionId`/`appliedInVersionId`, `authorId` vs `userId` on Comment/Annotation, the `kind`/`threadStatus`/`status` enum string values). Fix the seed to match before running.

- [ ] **Step 2: Run to verify it fails.** Run: `CI=true pnpm exec vitest run tests/unit/documents.delete.test.ts` → FAIL with `deleteDocument is not a function`.

- [ ] **Step 3: Implement `deleteDocument` in `lib/documents.ts`.**

```ts
/** Hard-delete a document and all dependents. Ordered to satisfy the
 *  onDelete: Restrict FKs on DocumentVersion (Annotation.created/appliedInVersion, Review.onVersion):
 *  remove reviews + annotations (comments cascade) first, then the document
 *  (versions, participants, notifications cascade). */
export async function deleteDocument(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.review.deleteMany({ where: { documentId: id } }),
    prisma.annotation.deleteMany({ where: { documentId: id } }),
    prisma.document.delete({ where: { id } }),
  ]);
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `CI=true pnpm exec vitest run tests/unit/documents.delete.test.ts` → PASS. If a `Restrict` error appears, a referrer was missed — confirm no other model has a `Restrict` FK to `DocumentVersion` beyond review/annotation (per the design spec, only those three).

- [ ] **Step 5: Commit.**

```bash
git add lib/documents.ts tests/unit/documents.delete.test.ts
git commit -m "feat(m4-p1): deleteDocument service with transactional cascade"
```

---

### Task 3: `DELETE /api/documents/[id]` route with authz ladder

**Goal:** An owner can delete via HTTP; non-owners and strangers are rejected with the right status codes.

**Files:**
- Modify: `app/api/documents/[id]/route.ts` (add `DELETE` handler)
- Test: `tests/unit/documents.delete-route.test.ts`

**Acceptance Criteria:**
- [ ] Unauthenticated → 401. Non-participant → 404. Participant non-owner → 403. Owner → 200 `{ ok: true }` and the document is gone.

**Verify:** `CI=true pnpm exec vitest run tests/unit/documents.delete-route.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test** (mirror Task 1's route-test harness for `requireUser` mocking and `params`):

```ts
// tests/unit/documents.delete-route.test.ts
import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createDocument } from "@/lib/documents";
import { DELETE } from "@/app/api/documents/[id]/route";
import * as authn from "@/lib/auth-helpers"; // confirm requireUser module path

async function makeUser(email: string) { return prisma.user.create({ data: { email, name: email.split("@")[0] } }); }
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("DELETE /api/documents/[id]", () => {
  beforeEach(async () => {
    await prisma.documentParticipant.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    await prisma.user.deleteMany();
  });

  test("owner deletes; non-owner 403; stranger 404", async () => {
    const owner = await makeUser("owner@example.com");
    const part = await makeUser("part@example.com");
    const stranger = await makeUser("str@example.com");
    const id = await createDocument(owner.id, "Plan", "# hi");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: part.id } });

    vi.spyOn(authn, "requireUser").mockResolvedValue({ id: stranger.id } as never);
    expect((await DELETE(new Request("http://t"), ctx(id))).status).toBe(404);

    vi.spyOn(authn, "requireUser").mockResolvedValue({ id: part.id } as never);
    expect((await DELETE(new Request("http://t"), ctx(id))).status).toBe(403);

    vi.spyOn(authn, "requireUser").mockResolvedValue({ id: owner.id } as never);
    const ok = await DELETE(new Request("http://t"), ctx(id));
    expect(ok.status).toBe(200);
    expect(await prisma.document.findUnique({ where: { id } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `CI=true pnpm exec vitest run tests/unit/documents.delete-route.test.ts` → FAIL (`DELETE` not exported).

- [ ] **Step 3: Implement the `DELETE` handler** in `app/api/documents/[id]/route.ts` (reuse the file's existing imports of `requireUser`, `isParticipant`, `isOwner`, `NextResponse`; add `deleteDocument` import):

```ts
import { deleteDocument } from "@/lib/documents";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await isOwner(user.id, id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await deleteDocument(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `CI=true pnpm exec vitest run tests/unit/documents.delete-route.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/api/documents/[id]/route.ts tests/unit/documents.delete-route.test.ts
git commit -m "feat(m4-p1): DELETE /api/documents/[id] owner-only route"
```

---

### Task 4: Delete button + confirmation modal (UI)

**Goal:** An owner sees a Delete button in the document header; confirming removes the document and navigates to `/app`.

**Files:**
- Modify: `components/DocumentView.tsx` (Delete button + confirm modal + handler)

**Acceptance Criteria:**
- [ ] Delete button visible only when `isOwner`.
- [ ] Clicking opens a confirm modal; confirming calls `DELETE /api/documents/[id]` and on `ok` navigates to `/app`.
- [ ] Cancel closes the modal with no request.

**Verify:** `CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint` clean; manual: as owner, delete a throwaway document → redirected to `/app`, document gone. (Optional light e2e below.)

**Steps:**

- [ ] **Step 1: Add state + handler in `DocumentView`** (near the other `useState` hooks and the `useRouter` import — add `import { useRouter } from "next/navigation";` and `const router = useRouter();` if not present):

```tsx
const [confirmingDelete, setConfirmingDelete] = useState(false);
const [deleting, setDeleting] = useState(false);

async function handleDelete() {
  setDeleting(true);
  const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
  if (res.ok) { router.push("/app"); return; }
  setDeleting(false);
  setConfirmingDelete(false);
}
```

- [ ] **Step 2: Add the Delete button** in the header actions block (the `mb-4 flex items-center gap-3` div, alongside Edit/History), owner-only:

```tsx
{isOwner && (
  <Button variant="danger" size="sm" data-testid="delete-document" onClick={() => setConfirmingDelete(true)}>
    Delete
  </Button>
)}
```

  (If `Button` has no `"danger"` variant, check `components/ui/Button.tsx` for the destructive variant name and use that; otherwise add a `danger` variant following the existing variant map.)

- [ ] **Step 3: Add the confirm modal** (reuse `Card`; render conditionally near the component root):

```tsx
{confirmingDelete && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
    <Card className="max-w-md space-y-4 p-6">
      <h2 className="text-lg font-semibold text-foreground">Delete this document?</h2>
      <p className="text-sm text-muted-foreground">
        This permanently removes the document and all its comments, versions, and reviews. This can&apos;t be undone.
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setConfirmingDelete(false)}>Cancel</Button>
        <Button variant="danger" size="sm" disabled={deleting} data-testid="confirm-delete" onClick={handleDelete}>
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Card>
  </div>
)}
```

  (Match the muted-text token name used elsewhere — `text-muted-foreground` or similar; check a sibling component.)

- [ ] **Step 4: Verify types/lint + manual check.** Run: `CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint` → clean. Then `CI=true pnpm dev`, create a throwaway document, delete it as owner, confirm redirect to `/app` and absence.

- [ ] **Step 5 (optional light e2e):** If adding e2e, extend an existing review/auth spec under `tests/e2e/` to: create a doc, click `delete-document`, click `confirm-delete`, assert URL is `/app` and the doc title is absent. Free port 3000 first (`lsof -ti tcp:3000 | xargs -r kill -9`).

- [ ] **Step 6: Commit.**

```bash
git add components/DocumentView.tsx tests/e2e/  # include e2e only if added
git commit -m "feat(m4-p1): owner delete button + confirm modal"
```

---

## Self-Review

- **Spec coverage:** verdict block (server + UI) → Task 1; delete service + Restrict-FK regression → Task 2; DELETE route authz ladder → Task 3; delete UI + redirect → Task 4. All spec "Files touched" are covered.
- **Type/name consistency:** `deleteDocument(id)` defined in Task 2, imported in Task 3; `requireUser` mock path flagged to confirm in Tasks 1 & 3; field names flagged to verify against schema in Task 2.
- **Placeholders:** none — code shown for every code step; the few "confirm against schema / Button variant" notes are verification instructions, not deferred work.

**Dependencies:** Task 3 blockedBy Task 2; Task 4 blockedBy Task 3. Task 1 independent.
