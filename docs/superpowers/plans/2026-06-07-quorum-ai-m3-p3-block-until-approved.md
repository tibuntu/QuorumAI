# M3/P3 — Block-Until-Approved Long-Poll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /api/plans/[id]/feedback/wait?timeoutMs=` long-poll endpoint that holds the connection open until a plan's decision/state changes (or a clamped timeout elapses), and update the `/pull-feedback` skill to loop on it until terminal.

**Architecture:** A pure, dependency-injected core (`lib/feedback-wait.ts`) subscribes to the existing in-process event bus (`lib/events.ts`), re-checks the DB on connect to close the poll↔connect race, then races a wake-event against a clamped timeout. A thin Next.js route handler applies the same owner-strict + `feedback:read` auth as the existing `GET …/feedback`, clamps the timeout via an env-tunable cap, and returns the P2 feedback body plus a `timedOut` flag. No schema change.

**Tech Stack:** Next.js App Router route handlers, Node `EventEmitter` bus, Prisma (read-only here), Vitest (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-06-06-quorum-ai-m3-p3-block-until-approved-design.md`

---

### Task 1: Core long-poll logic — `lib/feedback-wait.ts`

**Goal:** A pure, testable wait primitive: clamp the requested timeout and resolve when a wake-event fires, a terminal decision is already present on connect, or the timeout elapses.

**Files:**
- Create: `lib/feedback-wait.ts`
- Test: `tests/unit/feedback-wait.test.ts`

**Acceptance Criteria:**
- [ ] `clampTimeout` returns `min(default, max)` for missing/`NaN`/≤0 input, else `min(requested, max)`.
- [ ] `waitForFeedbackChange` subscribes **before** the on-connect DB re-check (race closure), and the re-check returns immediately with `timedOut: false` when the decision is already terminal.
- [ ] A wake-event (`review.updated` / `version.created`) resolves the wait with the fresh snapshot and `timedOut: false`.
- [ ] Non-wake events (`annotation.created`, `comment.created`, `annotation.updated`) do **not** resolve the wait.
- [ ] On timeout, resolves with the current snapshot and `timedOut: true`.
- [ ] `unsubscribe()` is always called (via `finally`), on every exit path.
- [ ] Returns `null` when the snapshot reader returns `null` (missing doc).

**Verify:** `CI=true pnpm test:unit -- feedback-wait` → all tests pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/feedback-wait.test.ts
import { describe, it, expect, vi } from "vitest";
import { clampTimeout, waitForFeedbackChange } from "@/lib/feedback-wait";
import type { DocEvent } from "@/lib/events";

type Snap = Awaited<ReturnType<typeof import("@/lib/feedback").getPlanFeedback>>;

const pending = { decision: "pending", state: "OPEN", markdown: "x", threads: [], reviews: [] } as unknown as NonNullable<Snap>;
const approved = { decision: "approved", state: "APPROVED", markdown: "x", threads: [], reviews: [] } as unknown as NonNullable<Snap>;

describe("clampTimeout", () => {
  it("falls back to min(default, max) for missing/NaN/<=0", () => {
    expect(clampTimeout(undefined, 60000, 30000)).toBe(30000);
    expect(clampTimeout(NaN, 60000, 30000)).toBe(30000);
    expect(clampTimeout(0, 60000, 30000)).toBe(30000);
    expect(clampTimeout(-5, 60000, 30000)).toBe(30000);
    expect(clampTimeout(undefined, 10000, 30000)).toBe(10000);
  });
  it("clamps a requested value to the max", () => {
    expect(clampTimeout(45000, 60000, 30000)).toBe(45000);
    expect(clampTimeout(120000, 60000, 30000)).toBe(60000);
  });
});

describe("waitForFeedbackChange", () => {
  it("subscribes before the DB re-check and returns immediately when already terminal", async () => {
    const order: string[] = [];
    const unsubscribe = vi.fn(() => { order.push("unsub"); });
    const subscribe = vi.fn((_id: string, _h: (e: DocEvent) => void) => { order.push("sub"); return unsubscribe; });
    const readSnapshot = vi.fn(async () => { order.push("read"); return approved; });

    const res = await waitForFeedbackChange("doc-1", 30000, { subscribe, readSnapshot });

    expect(res).toEqual({ ...approved, timedOut: false });
    expect(order).toEqual(["sub", "read", "unsub"]); // subscribe BEFORE read
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("resolves on a wake event with the fresh snapshot", async () => {
    let handler: ((e: DocEvent) => void) | undefined;
    const subscribe = vi.fn((_id: string, h: (e: DocEvent) => void) => { handler = h; return () => {}; });
    const readSnapshot = vi.fn()
      .mockResolvedValueOnce(pending)   // on-connect re-check
      .mockResolvedValueOnce(approved); // post-wake re-read

    const p = waitForFeedbackChange("doc-1", 30000, { subscribe, readSnapshot });
    await Promise.resolve(); // let the on-connect re-check run
    handler!({ type: "review.updated", state: "APPROVED" });

    expect(await p).toEqual({ ...approved, timedOut: false });
  });

  it("ignores non-wake events", async () => {
    vi.useFakeTimers();
    let handler: ((e: DocEvent) => void) | undefined;
    const subscribe = vi.fn((_id: string, h: (e: DocEvent) => void) => { handler = h; return () => {}; });
    const readSnapshot = vi.fn().mockResolvedValue(pending);

    const p = waitForFeedbackChange("doc-1", 5000, { subscribe, readSnapshot });
    await Promise.resolve();
    handler!({ type: "annotation.created", annotation: {} });
    handler!({ type: "comment.created", annotationId: "a", comment: {} });
    await vi.advanceTimersByTimeAsync(5000); // only the timeout should resolve it
    const res = await p;

    expect(res).toEqual({ ...pending, timedOut: true });
    vi.useRealTimers();
  });

  it("times out with the current pending snapshot", async () => {
    vi.useFakeTimers();
    const subscribe = vi.fn(() => () => {});
    const readSnapshot = vi.fn().mockResolvedValue(pending);

    const p = waitForFeedbackChange("doc-1", 5000, { subscribe, readSnapshot });
    await vi.advanceTimersByTimeAsync(5000);
    const res = await p;

    expect(res).toEqual({ ...pending, timedOut: true });
    vi.useRealTimers();
  });

  it("always unsubscribes, even on the terminal-on-connect path", async () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const readSnapshot = vi.fn().mockResolvedValue(approved);

    await waitForFeedbackChange("doc-1", 30000, { subscribe, readSnapshot });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("returns null when the snapshot is missing", async () => {
    const subscribe = vi.fn(() => () => {});
    const readSnapshot = vi.fn().mockResolvedValue(null);
    expect(await waitForFeedbackChange("gone", 30000, { subscribe, readSnapshot })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true pnpm test:unit -- feedback-wait`
Expected: FAIL — `lib/feedback-wait.ts` does not exist / exports undefined.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/feedback-wait.ts
import { subscribe as busSubscribe, type DocEvent } from "@/lib/events";
import { getPlanFeedback } from "@/lib/feedback";

/** Events that wake a waiter: a decision/state transition or a new version while pending. */
const WAKE_EVENTS = new Set<DocEvent["type"]>(["review.updated", "version.created"]);

/** Snapshot shape returned by getPlanFeedback (non-null) plus the long-poll flag. */
type Snapshot = NonNullable<Awaited<ReturnType<typeof getPlanFeedback>>>;
export type WaitResult = (Snapshot & { timedOut: boolean }) | null;

export interface WaitDeps {
  subscribe?: typeof busSubscribe;
  readSnapshot?: (documentId: string) => Promise<Snapshot | null>;
}

/** Clamp a client-requested timeout into [_, max], falling back to default when absent/invalid. */
export function clampTimeout(requested: number | undefined, max: number, dflt: number): number {
  if (requested === undefined || Number.isNaN(requested) || requested <= 0) return Math.min(dflt, max);
  return Math.min(requested, max);
}

/**
 * Hold until the plan's decision/state changes or `timeoutMs` elapses.
 *
 * Order matters: we subscribe FIRST, then re-check the DB, so a decision that
 * landed between the caller's last poll and this connect is caught by the
 * re-check rather than missed (spec D2). Returns null when the doc is gone.
 */
export async function waitForFeedbackChange(documentId: string, timeoutMs: number, deps: WaitDeps = {}): Promise<WaitResult> {
  const subscribe = deps.subscribe ?? busSubscribe;
  const readSnapshot = deps.readSnapshot ?? getPlanFeedback;

  let fired = false;
  let resolveEvent!: () => void;
  const eventPromise = new Promise<void>((resolve) => { resolveEvent = resolve; });
  const handler = (e: DocEvent) => {
    if (WAKE_EVENTS.has(e.type)) { fired = true; resolveEvent(); }
  };
  const unsubscribe = subscribe(documentId, handler);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // On-connect re-check closes the poll<->connect race.
    const initial = await readSnapshot(documentId);
    if (initial === null) return null;
    if (initial.decision !== "pending") return { ...initial, timedOut: false };

    const timeoutPromise = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    await Promise.race([eventPromise, timeoutPromise]);

    const snapshot = await readSnapshot(documentId);
    if (snapshot === null) return null;
    return { ...snapshot, timedOut: !fired };
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CI=true pnpm test:unit -- feedback-wait`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/feedback-wait.ts tests/unit/feedback-wait.test.ts
git commit -m "feat(feedback): long-poll wait primitive over the event bus"
```

---

### Task 2: Route handler — `app/api/plans/[id]/feedback/wait/route.ts`

**Goal:** Expose the wait primitive as an owner-strict, scope-gated GET that clamps the timeout via env and returns the P2 body plus `timedOut`, with `Cache-Control: no-store`.

**Files:**
- Create: `app/api/plans/[id]/feedback/wait/route.ts`

**Acceptance Criteria:**
- [ ] Auth ordering mirrors `app/api/plans/[id]/feedback/route.ts` exactly: 401 (no user) → 404 (`!isOwner`) → 403 (missing `feedback:read`).
- [ ] `timeoutMs` is read from the query string and clamped with `clampTimeout`, max from `FEEDBACK_WAIT_MAX_MS` (default 60000), default-when-missing 30000.
- [ ] Returns HTTP 200 with `{decision, state, markdown, threads, reviews, timedOut}` and header `Cache-Control: no-store`.
- [ ] Returns 404 if the wait primitive yields `null` (doc disappeared mid-wait).

**Verify:** `CI=true pnpm lint && CI=true pnpm build` → no type/lint errors for the new route.

**Steps:**

- [ ] **Step 1: Write the route**

```typescript
// app/api/plans/[id]/feedback/wait/route.ts
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { isOwner } from "@/lib/authz";
import { clampTimeout, waitForFeedbackChange } from "@/lib/feedback-wait";

const DEFAULT_TIMEOUT_MS = 30000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isOwner(authd.user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authd.scopes.includes("feedback:read")) return NextResponse.json({ error: "insufficient scope" }, { status: 403 });

  const maxMs = Number(process.env.FEEDBACK_WAIT_MAX_MS ?? 60000);
  const raw = new URL(req.url).searchParams.get("timeoutMs");
  const requested = raw === null ? undefined : Number(raw);
  const timeoutMs = clampTimeout(requested, maxMs, DEFAULT_TIMEOUT_MS);

  const result = await waitForFeedbackChange(id, timeoutMs);
  if (result === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 2: Verify build + lint**

Run: `CI=true pnpm lint && CI=true pnpm build`
Expected: PASS — route compiles, no lint errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/plans/[id]/feedback/wait/route.ts
git commit -m "feat(feedback): GET /api/plans/[id]/feedback/wait long-poll route"
```

---

### Task 3: E2e proof — extend `tests/e2e/authorization.spec.ts`

**Goal:** Prove end-to-end that an agent token waiting on a pending plan unblocks promptly when a reviewer approves, returning `decision: approved` and `timedOut: false`.

**Files:**
- Modify: `tests/e2e/authorization.spec.ts` (append a new `test(...)`)

**Acceptance Criteria:**
- [ ] An agent token opens `…/feedback/wait?timeoutMs=15000` on a freshly created plan (decision pending).
- [ ] Owner approves the plan via the reviews API while the wait is in flight.
- [ ] The wait request resolves with status 200, `decision: "approved"`, `timedOut: false`.

**Verify:** `CI=true pnpm test:e2e -- authorization` → the new test passes.

**Steps:**

- [ ] **Step 1: Append the test**

Add at the end of `tests/e2e/authorization.spec.ts` (the file already imports `test, expect, type Page` and defines `register`/`createDoc`). The owner uses a token with `feedback:read`; the plan is created via the API so the owner controls its id, and the approval is posted via `/api/documents/[id]/reviews` (owner-allowed, as shown in the existing spec).

```typescript
test("machine: feedback/wait blocks until a reviewer approves", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page);
  await page.goto("/app/settings/tokens");
  await page.getByLabel("token label").fill("ci");
  await page.getByRole("button", { name: "Create token" }).click();
  const token = await page.getByTestId("new-token").inputValue();

  const post = await page.request.post("/api/plans", {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: "Wait Plan", markdown: "The cloud setup needs review." },
  });
  expect(post.status()).toBe(201);
  const { id } = await post.json();
  expect(typeof id).toBe("string");
  expect(id.length).toBeGreaterThan(0);

  // Open the long-poll while the plan is still pending (do NOT await yet).
  const waitReq = page.request.get(`/api/plans/${id}/feedback/wait?timeoutMs=15000`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Approve via the reviews API; this publishes review.updated and flips state.
  const approve = await page.request.post(`/api/documents/${id}/reviews`, { data: { verdict: "APPROVE" } });
  expect(approve.status()).toBeLessThan(300);

  const waitRes = await waitReq;
  expect(waitRes.status()).toBe(200);
  const body = await waitRes.json();
  expect(body.decision).toBe("approved");
  expect(body.timedOut).toBe(false);

  await ctx.close();
});
```

- [ ] **Step 2: Run the e2e test**

Run: `CI=true pnpm test:e2e -- authorization`
Expected: PASS — including the new wait test.

> Note: if Playwright requires a running dev/build server, the project's `playwright.config.ts` `webServer` block handles startup; run as configured. If the reviews endpoint path or approval verb differs from the assumption above, adjust to match `app/api/documents/[id]/reviews/route.ts` (read it first) — the goal (approve → wait unblocks) is fixed, the exact call is not.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/authorization.spec.ts
git commit -m "test(e2e): feedback/wait unblocks on reviewer approval"
```

---

### Task 4: Update the `/pull-feedback` skill to loop

**Goal:** Replace the single GET with a bounded wait loop that re-arms until a terminal decision or a max iteration count, surfacing "still pending after N waits."

**Files:**
- Modify: `.claude/commands/pull-feedback.md`

**Acceptance Criteria:**
- [ ] The skill calls `…/feedback/wait?timeoutMs=30000` in a loop.
- [ ] Stops and presents the markdown digest (then revises) when `decision` is `approved` or `changes_requested`.
- [ ] On `timedOut`/`pending`, re-arms up to a max iteration count (e.g. 10), then surfaces "still pending after N waits" and stops.
- [ ] Still documents the required env vars and the `PATCH` revise-back path.

**Verify:** Manual read-through — the loop has a hard upper bound and a terminal-decision exit; no infinite loop. (Markdown-only change; no test command.)

**Steps:**

- [ ] **Step 1: Rewrite the skill body**

Replace the body of `.claude/commands/pull-feedback.md` (keep the frontmatter, updating `allowed-tools` if needed) with:

```markdown
---
allowed-tools: Bash(curl:*), Bash(jq:*)
description: Pull consolidated team feedback for a Quorum AI plan and revise accordingly.
---

Wait for a team decision on a plan, then revise. Blocks via long-poll instead of one-shot polling.

Requires env vars: `QUORUM_BASE_URL` and `QUORUM_API_TOKEN`. The plan id is `$ARGUMENTS`.

1. Wait loop (max 10 iterations, each a ~30s long-poll):
   ```
   for i in 1..10:
     resp = curl -s "$QUORUM_BASE_URL/api/plans/$ARGUMENTS/feedback/wait?timeoutMs=30000" \
       -H "Authorization: Bearer $QUORUM_API_TOKEN"
     decision = $(echo "$resp" | jq -r .decision)
     if decision == "approved" or decision == "changes_requested": break
     # decision == "pending" (timedOut true or a non-terminal change): re-arm
   ```
2. If the loop exhausted all iterations with `decision == "pending"`: tell the user the plan is still pending after 10 waits and stop.
3. Parse `{ decision, state, markdown, threads, reviews }` from the final response.
4. Present the `markdown` digest, then revise the plan to address every comment. If the user approves the revision, post it back with `PATCH $QUORUM_BASE_URL/api/plans/$ARGUMENTS` `{ markdown, baseVersionNumber }`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/pull-feedback.md
git commit -m "feat(skill): pull-feedback waits via long-poll until terminal"
```

---

## Self-Review

- **Spec coverage:** D1 long-poll over bus → Task 1 (`WAKE_EVENTS`, `subscribe`). D2 re-check after subscribe → Task 1 (subscribe-before-read test). D3 clamp + `timedOut` + HTTP 200 → Tasks 1 (`clampTimeout`) + 2 (env cap, no-store). D4 wake events / caller decides → Task 1 (`WAKE_EVENTS`) + Task 4 (skill stops on terminal). D5 owner-strict + `feedback:read` → Task 2. Skill loop → Task 4. Tests → Tasks 1 & 3. No schema change ✓.
- **Placeholder scan:** None — all code is concrete.
- **Type consistency:** `clampTimeout`, `waitForFeedbackChange`, `WaitDeps` names consistent across Tasks 1–2; response keys `{decision, state, markdown, threads, reviews, timedOut}` match `consolidateFeedback` output (Task 3 asserts the same keys).
- **Order/race:** subscribe → DB re-check → race → re-read, with `unsubscribe` + `clearTimeout` in `finally` — verified by the ordering and unsubscribe tests.

## Execution notes

Isolated worktree; `CI=true` for all test runs; rebase onto `main` (no merge). No Prisma schema/migration change in this phase.
