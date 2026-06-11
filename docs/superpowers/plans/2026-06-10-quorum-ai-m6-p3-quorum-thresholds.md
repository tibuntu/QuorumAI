# M6 · P3 — Quorum / N-Approver Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans (this plan is handed off to a SEPARATE session) — or superpowers-extended-cc:subagent-driven-development — to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a document owner require N approvals (1–10) before a plan reaches `APPROVED`, settable at create + edit, with "N of M approvals" surfaced in the UI and the machine feedback contract, recomputing state whenever the threshold changes.

**Architecture:** No schema migration — `Document.requiredApprovals Int @default(1)` exists and `computeDocumentState(reviews, requiredApprovals)` already honors it; the field is simply never set today. A pure `lib/quorum.ts` owns validation (`parseRequiredApprovals`, bound 1–10) and the `approvalCount` derivation. Create paths thread an optional `requiredApprovals`; a new `setRequiredApprovals` service (sharing an extracted recompute helper with `submitReview`) handles edits + state recompute; dedicated settings routes (web + machine) expose it; display + feedback render "N of M".

**Tech Stack:** Next.js 16, React 19, Prisma 7.8 + SQLite, Vitest (real test DB), Playwright e2e.

**User decisions (already made):**
- Edit via **dedicated settings routes** (`PATCH /api/documents/[id]/settings` web + `/api/plans/[id]/settings` machine) — NOT overloading the version-create PATCH.
- Validation: `requiredApprovals` is an **integer 1–10**.
- Owner threshold control is **independent of `EDIT_UI_ENABLED`** (governance, not content).
- Feedback fields are **additive** (no `schemaVersion` bump).
- Threshold change publishes the SSE `review.updated` state change + `decision.changed` on a flip, but does **NOT** notify participants (no new review).
- Out of scope: weighted/role-based approvals; requiring specific named reviewers.

> **Bootstrap (do once, first thing in Task 1):** this is a fresh worktree with no node_modules/.env. Run `CI=true pnpm install`; create `.env` (Write tool) with `AUTH_SECRET=<openssl rand -base64 32>`, `BASE_URL=http://localhost:3000`, `DATABASE_URL=file:./data/app.db`; `pnpm db:deploy`. No new migration is needed this phase.
> **Shell:** SCM Breeze breaks `&&` chaining + heredocs (`_safe_eval: command not found`). Run each command as its own Bash call; use `/usr/bin/git`; create/edit files with Write/Edit tools.

---

### Task 1: Bootstrap + pure `lib/quorum.ts` helper

**Goal:** Bootstrap the worktree, then add the pure quorum helper (validation bound + approval count) with unit tests.

**Files:**
- Create: `.env` (gitignored)
- Create: `lib/quorum.ts`
- Test: `tests/unit/quorum.test.ts`

**Acceptance Criteria:**
- [ ] Worktree bootstrapped: `CI=true pnpm install` ok, `.env` present, `pnpm db:deploy` clean.
- [ ] `MAX_REQUIRED_APPROVALS = 10`; `parseRequiredApprovals(v)` returns the integer for 1..10, else `null` (rejects 0, negatives, >10, non-integers, non-numbers, null/undefined); never throws.
- [ ] `approvalCount(reviews)` returns the count of `!dismissed && verdict==="APPROVE"`.
- [ ] Unit tests cover all bound cases + approvalCount.

**Verify:** `CI=true pnpm test:unit quorum` → all pass; `npx tsc --noEmit` → 0.

**Steps:**

- [ ] **Step 1: Bootstrap** (each its own Bash call): `CI=true pnpm install`; `openssl rand -base64 32` (use the output in the next step); Write `.env` with the three lines (real secret); `pnpm db:deploy`.

- [ ] **Step 2: Write the failing test** `tests/unit/quorum.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { MAX_REQUIRED_APPROVALS, parseRequiredApprovals, approvalCount } from "@/lib/quorum";

describe("parseRequiredApprovals", () => {
  test("accepts integers 1..10", () => {
    expect(parseRequiredApprovals(1)).toBe(1);
    expect(parseRequiredApprovals(10)).toBe(10);
    expect(parseRequiredApprovals(3)).toBe(3);
    expect(MAX_REQUIRED_APPROVALS).toBe(10);
  });
  test("rejects out-of-range, non-integer, non-number", () => {
    for (const bad of [0, -1, 11, 2.5, NaN, "3", null, undefined, {}, [3]]) {
      expect(parseRequiredApprovals(bad as unknown)).toBeNull();
    }
  });
});

describe("approvalCount", () => {
  test("counts only active APPROVE reviews", () => {
    const reviews = [
      { verdict: "APPROVE", dismissed: false },
      { verdict: "APPROVE", dismissed: true },   // dismissed → excluded
      { verdict: "REQUEST_CHANGES", dismissed: false },
      { verdict: "COMMENT", dismissed: false },
      { verdict: "APPROVE", dismissed: false },
    ];
    expect(approvalCount(reviews)).toBe(2);
    expect(approvalCount([])).toBe(0);
  });
});
```

- [ ] **Step 3: Run → fails** (`@/lib/quorum` not found): `CI=true pnpm test:unit quorum`

- [ ] **Step 4: Implement `lib/quorum.ts`**

```ts
export const MAX_REQUIRED_APPROVALS = 10;

/** Validate a requiredApprovals input. Returns the integer if 1..10, else null. Never throws. */
export function parseRequiredApprovals(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > MAX_REQUIRED_APPROVALS) return null;
  return value;
}

/** Count active (non-dismissed) APPROVE reviews — the "N" in "N of M approvals". */
export function approvalCount(reviews: { verdict: string; dismissed: boolean }[]): number {
  return reviews.filter((r) => !r.dismissed && r.verdict === "APPROVE").length;
}
```

- [ ] **Step 5: Run → passes**; `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add lib/quorum.ts tests/unit/quorum.test.ts
/usr/bin/git commit -m "feat(m6-p3): pure quorum helper (parseRequiredApprovals + approvalCount)"
```

---

### Task 2: Set `requiredApprovals` at creation (lib + both POST routes + form)

**Goal:** Allow an owner to set the threshold when creating a document, on web and machine APIs.

**Files:**
- Modify: `lib/documents.ts` (`createDocument` signature + create data)
- Modify: `app/api/documents/route.ts` (web POST)
- Modify: `app/api/plans/route.ts` (machine POST)
- Modify: `components/NewDocumentForm.tsx`
- Test: `tests/unit/documents.test.ts` (add a case)

**Acceptance Criteria:**
- [ ] `createDocument` accepts `opts.requiredApprovals?: number` and persists `requiredApprovals: opts?.requiredApprovals ?? 1`.
- [ ] Both POST routes: if `requiredApprovals` is present in the body, validate via `parseRequiredApprovals` → **400** if invalid; pass the value through. Absent → default 1.
- [ ] `NewDocumentForm` has a "Required approvals" number input (min 1, max 10, default 1, `aria-label="required approvals"`) included in the POST body.
- [ ] A unit test asserts `createDocument(..., { requiredApprovals: 3 })` persists 3, and absent → 1.

**Verify:** `CI=true pnpm test:unit documents` → pass; `npx tsc --noEmit` → 0.

**Steps:**

- [ ] **Step 1: `lib/documents.ts`** — update the `createDocument` signature + create call. Replace the opts type and the `prisma.document.create` data:

```ts
export async function createDocument(
  userId: string,
  title: string,
  markdown: string,
  opts?: { source?: DocumentSource; agentContext?: string; requiredApprovals?: number }
) {
  const doc = await prisma.document.create({
    data: {
      title,
      ownerId: userId,
      state: "OPEN",
      source: opts?.source ?? "WEB",
      agentContext: opts?.agentContext ?? null,
      requiredApprovals: opts?.requiredApprovals ?? 1,
    },
  });
  // ...rest unchanged (version create, currentVersion update, participant create, return doc.id)
}
```

- [ ] **Step 2: `app/api/documents/route.ts`** — validate + pass through. Add the import and replace the POST body handling:

```ts
import { parseRequiredApprovals } from "@/lib/quorum";
// ...
  if (!body || typeof body.title !== "string" || typeof body.markdown !== "string") {
    return NextResponse.json({ error: "title and markdown required" }, { status: 400 });
  }
  let requiredApprovals: number | undefined;
  if (body.requiredApprovals !== undefined) {
    const parsed = parseRequiredApprovals(body.requiredApprovals);
    if (parsed === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400 });
    requiredApprovals = parsed;
  }
  const id = await createDocument(user.id, body.title, body.markdown, { requiredApprovals });
  return NextResponse.json({ id }, { status: 201 });
```

- [ ] **Step 3: `app/api/plans/route.ts`** — same validation; merge into the existing opts (keep `source: "CLAUDE_CODE"` + `agentContext`):

```ts
import { parseRequiredApprovals } from "@/lib/quorum";
// ...
  const agentContext = typeof body.agentContext === "string" ? body.agentContext : undefined;
  let requiredApprovals: number | undefined;
  if (body.requiredApprovals !== undefined) {
    const parsed = parseRequiredApprovals(body.requiredApprovals);
    if (parsed === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400 });
    requiredApprovals = parsed;
  }
  const id = await createDocument(authd.user.id, body.title, body.markdown, { source: "CLAUDE_CODE", agentContext, requiredApprovals });
```

- [ ] **Step 4: `components/NewDocumentForm.tsx`** — add state `const [requiredApprovals, setRequiredApprovals] = useState(1);`, include it in the POST body (`body: JSON.stringify({ title, markdown, requiredApprovals })`), and add this control after the Markdown field (before the error `<p>`):

```tsx
      <label className="flex flex-col gap-1 text-sm text-foreground">
        Required approvals
        <Input
          aria-label="required approvals"
          type="number"
          min={1}
          max={10}
          value={requiredApprovals}
          onChange={(e) => setRequiredApprovals(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
          className="w-24"
        />
      </label>
```

- [ ] **Step 5: Add a unit test to `tests/unit/documents.test.ts`** (follow the file's existing `makeUser`/createDocument patterns; read it first):

```ts
test("createDocument persists requiredApprovals (default 1)", async () => {
  const u = await makeUser();
  const a = await createDocument(u.id, "T", "body", { requiredApprovals: 3 });
  expect((await prisma.document.findUnique({ where: { id: a } }))?.requiredApprovals).toBe(3);
  const b = await createDocument(u.id, "T2", "body");
  expect((await prisma.document.findUnique({ where: { id: b } }))?.requiredApprovals).toBe(1);
});
```
(If `makeUser`/imports differ, match the file. `createDocument` is already imported there or add it.)

- [ ] **Step 6: Verify + commit**

```bash
CI=true pnpm test:unit documents
npx tsc --noEmit
/usr/bin/git add lib/documents.ts app/api/documents/route.ts app/api/plans/route.ts components/NewDocumentForm.tsx tests/unit/documents.test.ts
/usr/bin/git commit -m "feat(m6-p3): set requiredApprovals at document creation"
```

---

### Task 3: `setRequiredApprovals` service + extracted shared recompute

**Goal:** Add a service that updates the threshold and recomputes document state, sharing the recompute logic with `submitReview` (whose observable behavior must not change).

**Files:**
- Modify: `lib/reviews.ts`
- Test: `tests/unit/reviews.test.ts` (add cases) — or a new `tests/unit/quorum-threshold.test.ts`

**Acceptance Criteria:**
- [ ] A shared internal helper recomputes state from current reviews + `requiredApprovals`, persists it, and returns `{ state, prevState }`. `submitReview` uses it and its behavior (delete-prior + create review, publish `review.updated`, `notifyParticipants`, dispatch `review.updated`, conditional `decision.changed`) is unchanged.
- [ ] `setRequiredApprovals(userId, documentId, n)` updates `requiredApprovals`, recomputes + persists state, publishes `review.updated` with the new state, and dispatches `decision.changed` only if the state flipped. It does NOT call `notifyParticipants`.
- [ ] Unit tests: raising the threshold above current approvals → `OPEN`; lowering to/below → `APPROVED`; with an active `REQUEST_CHANGES` → stays `CHANGES_REQUESTED`; the new `requiredApprovals` is persisted.

**Verify:** `CI=true pnpm test:unit reviews` → all pass (incl. existing); `npx tsc --noEmit` → 0.

**Steps:**

- [ ] **Step 1: Refactor `lib/reviews.ts`** — extract the recompute tail and add the service. Full new file content:

```ts
import { prisma } from "@/lib/db";
import { computeDocumentState } from "@/lib/review-state";
import type { ReviewVerdict } from "@/lib/enums";
import { publish } from "@/lib/events";
import { notifyParticipants } from "@/lib/notifications";
import { dispatch } from "@/lib/webhooks";

/**
 * Recompute the document's state from its current reviews + requiredApprovals,
 * persist it, and publish the SSE state change. Returns prev + new state so the
 * caller can decide whether to dispatch decision.changed. Shared by submitReview
 * and setRequiredApprovals.
 */
async function recomputeState(documentId: string): Promise<{ state: string; prevState: string }> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { requiredApprovals: true, state: true },
  });
  if (!doc) throw new Error("document not found");
  const prevState = doc.state;
  const reviews = await prisma.review.findMany({ where: { documentId } });
  const state = computeDocumentState(
    reviews.map((r) => ({ verdict: r.verdict as ReviewVerdict, dismissed: r.dismissed })),
    doc.requiredApprovals,
  );
  await prisma.document.update({ where: { id: documentId }, data: { state } });
  publish(documentId, { type: "review.updated", state });
  return { state, prevState };
}

export async function submitReview(userId: string, documentId: string, verdict: ReviewVerdict) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");

  // One active verdict per reviewer for the current version: replace any prior.
  await prisma.review.deleteMany({ where: { documentId, reviewerId: userId } });
  await prisma.review.create({ data: { documentId, reviewerId: userId, verdict, onVersionId: doc.currentVersionId } });

  const { state, prevState } = await recomputeState(documentId);
  await notifyParticipants(documentId, userId, "review").catch(() => {});
  await dispatch(documentId, "review.updated", { decision: state.toLowerCase() }, userId).catch(() => {});
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase() }, userId).catch(() => {});
  }
  return state;
}

/**
 * Owner sets the approval threshold. Caller MUST have authorized owner + validated n (1–10).
 * Updates requiredApprovals, recomputes state, publishes review.updated, and dispatches
 * decision.changed on a flip. Does NOT notify participants (no new review occurred).
 */
export async function setRequiredApprovals(userId: string, documentId: string, n: number): Promise<string> {
  await prisma.document.update({ where: { id: documentId }, data: { requiredApprovals: n } });
  const { state, prevState } = await recomputeState(documentId);
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase() }, userId).catch(() => {});
  }
  return state;
}
```
> Note: `submitReview` previously read `requiredApprovals`/`state` itself; that read now lives in `recomputeState`. Net behavior is identical — it still deletes/creates the review, recomputes against `requiredApprovals`, persists, publishes `review.updated`, notifies, dispatches `review.updated` always + `decision.changed` on change.

- [ ] **Step 2: Add tests to `tests/unit/reviews.test.ts`** (read the file first for `makeUser`/`createDocument`/participant patterns; reviewers must be non-owner per M4/P1, and use `submitReview` to create approvals). Example cases:

```ts
import { setRequiredApprovals } from "@/lib/reviews";
// ...
test("raising the threshold above current approvals flips APPROVED→OPEN", async () => {
  const owner = await makeUser();
  const r1 = await makeUser();
  const docId = await createDocument(owner.id, "P", "body"); // requiredApprovals defaults to 1
  await prisma.documentParticipant.create({ data: { documentId: docId, userId: r1.id } });
  await submitReview(r1.id, docId, "APPROVE"); // 1 approval ≥ 1 → APPROVED
  expect((await prisma.document.findUnique({ where: { id: docId } }))?.state).toBe("APPROVED");

  const state = await setRequiredApprovals(owner.id, docId, 2); // now needs 2
  expect(state).toBe("OPEN");
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  expect(doc?.requiredApprovals).toBe(2);
  expect(doc?.state).toBe("OPEN");
  await prisma.document.delete({ where: { id: docId } });
});

test("lowering the threshold to/below current approvals flips OPEN→APPROVED", async () => {
  const owner = await makeUser();
  const r1 = await makeUser();
  const docId = await createDocument(owner.id, "P", "body", { requiredApprovals: 2 });
  await prisma.documentParticipant.create({ data: { documentId: docId, userId: r1.id } });
  await submitReview(r1.id, docId, "APPROVE"); // 1 of 2 → OPEN
  expect((await prisma.document.findUnique({ where: { id: docId } }))?.state).toBe("OPEN");

  const state = await setRequiredApprovals(owner.id, docId, 1);
  expect(state).toBe("APPROVED");
  await prisma.document.delete({ where: { id: docId } });
});

test("an active REQUEST_CHANGES keeps CHANGES_REQUESTED regardless of threshold", async () => {
  const owner = await makeUser();
  const r1 = await makeUser();
  const docId = await createDocument(owner.id, "P", "body");
  await prisma.documentParticipant.create({ data: { documentId: docId, userId: r1.id } });
  await submitReview(r1.id, docId, "REQUEST_CHANGES");
  const state = await setRequiredApprovals(owner.id, docId, 1);
  expect(state).toBe("CHANGES_REQUESTED");
  await prisma.document.delete({ where: { id: docId } });
});
```

- [ ] **Step 3: Verify + commit** — run the FULL reviews suite + the existing notifications/webhooks tests that exercise submitReview to confirm no behavior regression.

```bash
CI=true pnpm test:unit reviews
CI=true pnpm test:unit notifications.test
npx tsc --noEmit
/usr/bin/git add lib/reviews.ts tests/unit/reviews.test.ts
/usr/bin/git commit -m "feat(m6-p3): setRequiredApprovals service + shared state recompute"
```

---

### Task 4: Dedicated settings routes (web + machine)

**Goal:** Expose `setRequiredApprovals` via owner-only PATCH endpoints on both surfaces, with validation and the existing auth ladders.

**Files:**
- Create: `app/api/documents/[id]/settings/route.ts`
- Create: `app/api/plans/[id]/settings/route.ts`
- Test: `tests/unit/settings.quorum.test.ts`

**Acceptance Criteria:**
- [ ] Web `PATCH /api/documents/[id]/settings`: `requireUser`; non-participant → 404; participant non-owner → 403; invalid `requiredApprovals` → 400; success → 200 `{ ok: true, requiredApprovals, state }` and persists.
- [ ] Machine `PATCH /api/plans/[id]/settings`: `requireApiUser`; non-owner → 404; missing `plans:write` scope → 403; invalid → 400; success → 200 `{ requiredApprovals, state }`.
- [ ] Unit tests cover 200 / 400 / 403 / 404 for the web route (mirror `tests/unit/settings.notifications.test.ts` + `reviews.owner-block.test.ts`).

**Verify:** `CI=true pnpm test:unit settings.quorum` → pass; `npx tsc --noEmit` → 0.

**Steps:**

- [ ] **Step 1: Create `app/api/documents/[id]/settings/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { isParticipant, isOwner } from "@/lib/authz";
import { parseRequiredApprovals } from "@/lib/quorum";
import { setRequiredApprovals } from "@/lib/reviews";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await isOwner(user.id, id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const n = parseRequiredApprovals(body?.requiredApprovals);
  if (n === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400 });
  const state = await setRequiredApprovals(user.id, id, n);
  return NextResponse.json({ ok: true, requiredApprovals: n, state });
}
```

- [ ] **Step 2: Create `app/api/plans/[id]/settings/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { isOwner } from "@/lib/authz";
import { parseRequiredApprovals } from "@/lib/quorum";
import { setRequiredApprovals } from "@/lib/reviews";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isOwner(authd.user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const n = parseRequiredApprovals(body?.requiredApprovals);
  if (n === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400 });
  const state = await setRequiredApprovals(authd.user.id, id, n);
  return NextResponse.json({ requiredApprovals: n, state });
}
```

- [ ] **Step 3: Create `tests/unit/settings.quorum.test.ts`** (mirror `settings.notifications.test.ts`: mock `@/lib/api` `requireUser`; real DB for users/docs; use `createDocument` so the caller is the owner+participant):

```ts
import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PATCH } from "@/app/api/documents/[id]/settings/route";
import { createDocument } from "@/lib/documents";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

async function makeUser(label: string) {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${label}-${Date.now()}-${Math.round(Math.random()*1e6)}`, name: "x", email: `u-${label}-${Date.now()}-${Math.round(Math.random()*1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}
const req = (b: unknown) => new Request("http://t", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/documents/[id]/settings", () => {
  beforeEach(() => vi.mocked(api.requireUser).mockReset());

  test("owner sets a valid threshold → 200 + persisted", async () => {
    const owner = await makeUser("o");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const docId = await createDocument(owner.id, "P", "body");
    const res = await PATCH(req({ requiredApprovals: 3 }), ctx(docId));
    expect(res.status).toBe(200);
    expect((await prisma.document.findUnique({ where: { id: docId } }))?.requiredApprovals).toBe(3);
  });

  test("invalid threshold → 400", async () => {
    const owner = await makeUser("o2");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const docId = await createDocument(owner.id, "P", "body");
    expect((await PATCH(req({ requiredApprovals: 0 }), ctx(docId))).status).toBe(400);
    expect((await PATCH(req({ requiredApprovals: 99 }), ctx(docId))).status).toBe(400);
  });

  test("participant non-owner → 403", async () => {
    const owner = await makeUser("o3");
    const other = await makeUser("p3");
    const docId = await createDocument(owner.id, "P", "body");
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: other.id } });
    vi.mocked(api.requireUser).mockResolvedValue({ id: other.id } as never);
    expect((await PATCH(req({ requiredApprovals: 2 }), ctx(docId))).status).toBe(403);
  });

  test("non-participant → 404", async () => {
    const owner = await makeUser("o4");
    const stranger = await makeUser("s4");
    const docId = await createDocument(owner.id, "P", "body");
    vi.mocked(api.requireUser).mockResolvedValue({ id: stranger.id } as never);
    expect((await PATCH(req({ requiredApprovals: 2 }), ctx(docId))).status).toBe(404);
  });
});
```

- [ ] **Step 4: Verify + commit**

```bash
CI=true pnpm test:unit settings.quorum
npx tsc --noEmit
/usr/bin/git add "app/api/documents/[id]/settings/route.ts" "app/api/plans/[id]/settings/route.ts" tests/unit/settings.quorum.test.ts
/usr/bin/git commit -m "feat(m6-p3): owner-only settings routes for requiredApprovals"
```

---

### Task 5: Display "N of M approvals" + owner threshold control

**Goal:** Surface approval progress in the document view and let the owner change the threshold inline.

**Files:**
- Modify: `app/app/documents/[id]/page.tsx` (thread `requiredApprovals` + `approvals` into `ClientDocument`)
- Modify: `components/DocumentView.tsx` (`ClientDocument` type + render)

**Acceptance Criteria:**
- [ ] `ClientDocument` gains `requiredApprovals: number` and `approvals: number`; the page maps them from `doc.requiredApprovals` and `approvalCount(doc.reviews)`.
- [ ] The review-bar card shows `"{approvals} of {requiredApprovals} approvals"` (`data-testid="approval-progress"`) next to the state badge.
- [ ] Owner sees a number input (`aria-label="required approvals"`, `data-testid="required-approvals"`, min 1 max 10) that PATCHes `/api/documents/[id]/settings` and updates the badge from the returned `state`. Non-owners do not see the control. Not gated by `EDIT_UI_ENABLED`.
- [ ] All existing `data-testid`/`aria-label`/button names preserved; `npx tsc --noEmit` 0, `pnpm lint` 0.

**Verify:** `npx tsc --noEmit` → 0; `pnpm lint` → 0. (Behavior validated by the Task 7 e2e.)

**Steps:**

- [ ] **Step 1: `app/app/documents/[id]/page.tsx`** — import the helper and add two fields to the `serializable` object:

```tsx
import { approvalCount } from "@/lib/quorum";
// ... inside serializable, alongside state/versionNumber:
    requiredApprovals: doc.requiredApprovals,
    approvals: approvalCount(doc.reviews),
```

- [ ] **Step 2: `components/DocumentView.tsx`** — extend the `ClientDocument` interface:

```ts
export interface ClientDocument {
  id: string;
  title: string;
  state: string;
  versionNumber: number;
  markdown: string;
  requiredApprovals: number;
  approvals: number;
  annotations: ClientAnnotation[];
}
```

- [ ] **Step 3: `components/DocumentView.tsx`** — add local threshold state near `docState` (around line 114): `const [requiredApprovals, setRequiredApprovals] = useState(doc.requiredApprovals);` and a handler:

```tsx
  async function changeThreshold(n: number) {
    const clamped = Math.max(1, Math.min(10, n || 1));
    setRequiredApprovals(clamped);
    const res = await fetch(`/api/documents/${doc.id}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requiredApprovals: clamped }),
    }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      if (typeof data.state === "string") setDocState(data.state);
    }
  }
```

- [ ] **Step 4: `components/DocumentView.tsx`** — in the review-bar `Card` (the one with `data-testid="doc-state"`, ~line 703), add the progress text + owner control. Replace that Card's body so it shows the badge, the progress, and (owner only) the input:

```tsx
        <Card className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <Badge tone={stateTone(docState)} data-testid="doc-state">
              {STATE_LABELS[docState] ?? docState}
            </Badge>
            {!isOwner && (
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={() => submitReview("APPROVE")}>Approve</Button>
                <Button variant="danger" size="sm" onClick={() => submitReview("REQUEST_CHANGES")}>Request changes</Button>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-muted">
            <span data-testid="approval-progress">{doc.approvals} of {requiredApprovals} approvals</span>
            {isOwner && (
              <label className="flex items-center gap-1 text-xs">
                Required
                <input
                  type="number"
                  min={1}
                  max={10}
                  aria-label="required approvals"
                  data-testid="required-approvals"
                  value={requiredApprovals}
                  onChange={(e) => changeThreshold(Number(e.target.value))}
                  className="w-16 rounded-md border border-border bg-surface px-1.5 py-0.5 text-foreground accent-[var(--primary)]"
                />
              </label>
            )}
          </div>
        </Card>
```
> Keep the existing non-owner Approve/Request-changes buttons (now inside the top row). `doc.approvals` is the server-rendered count (updates on reload); `requiredApprovals` state updates live as the owner edits. The badge updates live via the existing `review.updated` SSE handler.

- [ ] **Step 5: Verify + commit**

```bash
npx tsc --noEmit
pnpm lint
/usr/bin/git add "app/app/documents/[id]/page.tsx" components/DocumentView.tsx
/usr/bin/git commit -m "feat(m6-p3): show N-of-M approvals + owner threshold control"
```

---

### Task 6: Surface threshold + approvals in the feedback contract

**Goal:** Add `requiredApprovals` + `approvals` to `consolidateFeedback` so the agent loop sees approval progress.

**Files:**
- Modify: `lib/feedback.ts` (`consolidateFeedback` + the `FeedbackDetail` type if needed)
- Test: `tests/unit/feedback.test.ts` (add a case)

**Acceptance Criteria:**
- [ ] `consolidateFeedback` return object includes `requiredApprovals: number` and `approvals: number` (= `approvalCount(detail.reviews)`).
- [ ] The rendered `markdown` includes a line `Approvals: {approvals} of {requiredApprovals}`.
- [ ] `schemaVersion` stays `1` (additive change).
- [ ] A unit test asserts both fields + the markdown line.

**Verify:** `CI=true pnpm test:unit feedback` → pass; `npx tsc --noEmit` → 0.

**Steps:**

- [ ] **Step 1: `lib/feedback.ts`** — import `approvalCount`, ensure `FeedbackDetail` carries `requiredApprovals` + `reviews` (it already maps `detail.reviews`; add `requiredApprovals: number` to the `FeedbackDetail` interface). Compute and include the fields:

```ts
import { approvalCount } from "@/lib/quorum";
// ... in consolidateFeedback, after `reviews` is built:
  const approvals = approvalCount(detail.reviews);
  // add to the markdown lines, right after the decision header block:
  lines.push(`Approvals: ${approvals} of ${detail.requiredApprovals}`, "");
  // ... and in the returned object add:
  return {
    schemaVersion: 1 as const,
    decision,
    state: detail.state,
    requiredApprovals: detail.requiredApprovals,
    approvals,
    markdown: lines.join("\n"),
    // ...rest unchanged
  };
```
> `getDocumentDetail` returns the `requiredApprovals` scalar (it uses `include`), so `getPlanFeedback` → `consolidateFeedback(detail)` already has it at runtime; just widen the `FeedbackDetail` type to include `requiredApprovals: number`.

- [ ] **Step 2: Add a test to `tests/unit/feedback.test.ts`** (read the file for its detail-builder/fixture style; minimal shape):

```ts
test("includes requiredApprovals + approvals (count of active APPROVE)", () => {
  const detail = {
    state: "OPEN",
    requiredApprovals: 2,
    currentVersion: { versionNumber: 1 },
    versions: [],
    annotations: [],
    reviews: [
      { reviewer: { name: "A" }, verdict: "APPROVE", dismissed: false },
      { reviewer: { name: "B" }, verdict: "APPROVE", dismissed: true },
    ],
  } as unknown as Parameters<typeof consolidateFeedback>[0];
  const out = consolidateFeedback(detail);
  expect(out.requiredApprovals).toBe(2);
  expect(out.approvals).toBe(1);
  expect(out.markdown).toContain("Approvals: 1 of 2");
});
```
(Match the existing import of `consolidateFeedback` + any fixture helper in the file.)

- [ ] **Step 3: Verify + commit**

```bash
CI=true pnpm test:unit feedback
npx tsc --noEmit
/usr/bin/git add lib/feedback.ts tests/unit/feedback.test.ts
/usr/bin/git commit -m "feat(m6-p3): surface requiredApprovals + approvals in feedback contract"
```

---

### Task 7: E2E + full verification gate

**Goal:** Prove the quorum flow end-to-end and the whole suite green.

**Files:**
- Create: `tests/e2e/quorum.spec.ts`

**Acceptance Criteria:**
- [ ] E2E: owner creates a doc with required approvals = 2; a separate reviewer approves → state still `Open`, progress shows "1 of 2" (after reload); owner lowers the threshold to 1 → state becomes `Approved`.
- [ ] Full gate green: `CI=true pnpm test:unit`; `pnpm test:e2e`; `pnpm lint`; `npx tsc --noEmit`; `pnpm build` 0 errors.

**Verify:** all five commands green.

**Steps:**

- [ ] **Step 1: Create `tests/e2e/quorum.spec.ts`** (reuse the `register` helper pattern from `tests/e2e/presence.spec.ts`; two contexts — owner + reviewer; the owner cannot review their own doc, so the approval comes from the reviewer who must be a participant — adding a comment or being added makes them a participant; simplest is the reviewer opens the doc URL after the owner shares/grants, mirroring how `selections.spec.ts`/`presence.spec.ts` get a second user into one doc):

```ts
import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string) {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random()*1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("quorum threshold gates approval", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const reviewerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const reviewer = await reviewerCtx.newPage();

  await register(owner, "Olive");
  await register(reviewer, "Remy");

  // Owner creates a doc requiring 2 approvals.
  await owner.goto("/app");
  await owner.getByLabel("title").fill("Quorum demo");
  await owner.getByLabel("markdown").fill("# Plan\n\nReview this.");
  await owner.getByLabel("required approvals").fill("2");
  await owner.getByRole("button", { name: "Create document" }).click();
  await expect(owner).toHaveURL(/\/app\/documents\//);
  const url = owner.url();
  await expect(owner.getByTestId("approval-progress")).toHaveText("0 of 2 approvals");

  // Reviewer opens the same doc (becomes a participant on access-grant) and approves.
  await reviewer.goto(url);
  await reviewer.getByRole("button", { name: "Approve" }).click();
  // 1 of 2 → still Open.
  await expect(reviewer.getByTestId("doc-state")).toHaveText("Open");

  // Owner reloads to see the updated count, then lowers the threshold to 1.
  await owner.reload();
  await expect(owner.getByTestId("approval-progress")).toHaveText("1 of 2 approvals");
  await owner.getByTestId("required-approvals").fill("1");
  await owner.getByTestId("required-approvals").blur();
  await expect(owner.getByTestId("doc-state")).toHaveText("Approved");

  await ownerCtx.close();
  await reviewerCtx.close();
});
```
> If a participant-grant step is required for the reviewer to load the doc, mirror the EXACT mechanism used in `tests/e2e/presence.spec.ts` / `selections.spec.ts` (they already get two users into one document). If the inline number input does not fire on `fill`+`blur`, dispatch a change via `.fill()` then press `Tab`, or click an explicit save affordance — adjust to make the PATCH fire and the badge update.

- [ ] **Step 2: Run the full gate** (each its own Bash call)

```bash
CI=true pnpm test:unit
pnpm lint
npx tsc --noEmit
pnpm build
lsof -ti tcp:3000 | xargs -r kill -9
pnpm test:e2e
```
Expected: unit all pass; lint 0; tsc 0; build 0 errors; e2e all pass (incl. quorum.spec.ts). Re-run a flaky spec once; report genuine failures.

- [ ] **Step 3: Commit + finish**

```bash
/usr/bin/git add tests/e2e/quorum.spec.ts
/usr/bin/git commit -m "test(m6-p3): e2e quorum threshold gating"
```
Leave the branch ready to fast-forward into local `main` (do NOT push, do NOT open a PR). Report the gate results.
