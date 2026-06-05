# Quorum AI — Review Core Part 3 (Integration & Packaging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the hero loop — a Bearer-token machine API (`/api/plans`) for agents to push plans and pull consolidated feedback, API-token management, participant-based in-app notifications, the `/push-plan` + `/pull-feedback` commands shipped in-repo, and finalized single-container packaging.

**Architecture:** Same layering as Parts 1–2 — pure libs (`lib/feedback.ts`), services (`lib/tokens.ts`, `lib/notifications.ts`), thin routes, client UI. Machine routes authenticate via Bearer tokens (`ApiToken`, sha256-hashed); web routes keep better-auth sessions. A "plan" is a `Document(source=CLAUDE_CODE)`, so the machine API reuses Part 1/2 services (`createDocument`, `createVersion`, `getDocumentDetail`).

**Tech Stack:** (existing) Next.js 16, Prisma 7/SQLite, better-auth, Tailwind v4, Vitest, Playwright. (new) none — tokens use Node `crypto`; SSE/versioning reused from Part 2.

**Conventions:** Plain commit messages, **no `Co-Authored-By` / AI attribution trailer**. Shell has SCM Breeze — use Write/Edit (not heredocs), single-line Bash, prefer `command git`. Next 16 route handlers: `params` is a Promise (`const { id } = await params`). Deterministic logic in pure libs; DB in services; routes thin. Value-sets in `lib/enums.ts` (`DocumentSource = ["WEB","CLAUDE_CODE"]` already exists). Branch `part-3-packaging`; rebase onto `main` if it advances.

---

### Task 1: Notification schema + migration

**Goal:** Add a `Notification` model (recipient, document, type, actor, read) with inverse relations and a migration.

**Files:**
- Modify: `prisma/schema.prisma`
- Create (generated): `prisma/migrations/<timestamp>_notifications/migration.sql`

**Acceptance Criteria:**
- [ ] `Notification` model exists with `userId`, `documentId`, `type`, `actorId?`, `read`, `createdAt` + the two indexes
- [ ] `User` and `Document` have `notifications Notification[]` inverse relations
- [ ] Migration applies; existing unit tests (24) + build pass

**Verify:** `pnpm prisma migrate dev --name notifications` applies; `pnpm test:unit` → 24 passed; `pnpm build` passes.

**Steps:**

- [ ] **Step 1:** Append the model to `prisma/schema.prisma`:

```prisma
model Notification {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  documentId String
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  type       String
  actorId    String?
  read       Boolean  @default(false)
  createdAt  DateTime @default(now())

  @@index([userId, read])
  @@index([documentId])
}
```

- [ ] **Step 2:** Add inverse relations. On the `User` model add `notifications Notification[]`. On the `Document` model add `notifications Notification[]`.

- [ ] **Step 3:** Run `pnpm prisma migrate dev --name notifications`. Expected: migration applied + client regenerated.

- [ ] **Step 4:** `pnpm test:unit` → 24 passed; `pnpm build` → passes.

- [ ] **Step 5:** Commit:
```bash
command git add prisma/schema.prisma prisma/migrations
command git commit -m "feat: add notification model"
```

---

### Task 2: API token service (`lib/tokens.ts`)

**Goal:** Generate (plaintext-once), verify (hash-lookup + lastUsedAt bump), list, and revoke API tokens.

**Files:**
- Create: `lib/tokens.ts`, `tests/unit/tokens.test.ts`

**Acceptance Criteria:**
- [ ] `generateToken` returns `{ id, token }` with `token` starting `qai_`; only the sha256 hash is stored
- [ ] `verifyToken("Bearer <token>")` returns the user and bumps `lastUsedAt`; garbage/missing → `null`
- [ ] `listTokens` never returns `tokenHash`
- [ ] `revokeToken` makes the token no longer verify

**Verify:** `pnpm test:unit -- tests/unit/tokens.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Implement** `lib/tokens.ts`:

```ts
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function generateToken(userId: string, label: string) {
  const token = `qai_${randomBytes(32).toString("base64url")}`;
  const row = await prisma.apiToken.create({ data: { userId, label, tokenHash: hashToken(token) } });
  return { id: row.id, token };
}

export async function verifyToken(authorization: string | null) {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return null;
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(match[1]) }, include: { user: true } });
  if (!row) return null;
  await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return row.user;
}

export async function listTokens(userId: string) {
  return prisma.apiToken.findMany({
    where: { userId },
    select: { id: true, label: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeToken(userId: string, id: string) {
  await prisma.apiToken.deleteMany({ where: { id, userId } });
}
```

- [ ] **Step 2: Test** `tests/unit/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { generateToken, verifyToken, listTokens, revokeToken } from "@/lib/tokens";

async function makeUser() {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: "U", email: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("tokens service", () => {
  it("generates, verifies, lists, revokes", async () => {
    const user = await makeUser();
    const { id, token } = await generateToken(user.id, "ci");
    expect(token.startsWith("qai_")).toBe(true);

    const verified = await verifyToken(`Bearer ${token}`);
    expect(verified?.id).toBe(user.id);

    expect(await verifyToken("Bearer nonsense")).toBeNull();
    expect(await verifyToken(null)).toBeNull();
    expect(await verifyToken(token)).toBeNull(); // missing "Bearer " prefix

    const list = await listTokens(user.id);
    expect(list.find((t) => t.id === id)).toBeTruthy();
    expect((list[0] as Record<string, unknown>).tokenHash).toBeUndefined();

    await revokeToken(user.id, id);
    expect(await verifyToken(`Bearer ${token}`)).toBeNull();
  });
});
```

- [ ] **Step 3:** Run → fail (module not found) → after impl, `pnpm test:unit -- tests/unit/tokens.test.ts` → PASS.

- [ ] **Step 4:** Commit:
```bash
command git add lib/tokens.ts tests/unit/tokens.test.ts
command git commit -m "feat: add api token service"
```

---

### Task 3: Feedback consolidation (`lib/feedback.ts`)

**Goal:** Pure `consolidateFeedback(detail)` → injectable markdown digest + structured JSON + a `decision` derived from document state; plus a `getPlanFeedback(id)` service wrapper.

**Files:**
- Create: `lib/feedback.ts`, `tests/unit/feedback.test.ts`

**Acceptance Criteria:**
- [ ] `decision`: `CHANGES_REQUESTED→"changes_requested"`, `APPROVED→"approved"`, else `"pending"`
- [ ] `markdown` lists each thread's quote + comments and a verdict tally; empty → a "no inline comments" line
- [ ] `threads`/`reviews` structured arrays returned
- [ ] `getPlanFeedback` returns `null` for an unknown id

**Verify:** `pnpm test:unit -- tests/unit/feedback.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Implement** `lib/feedback.ts`:

```ts
import { getDocumentDetail } from "@/lib/documents";

type Author = { name?: string | null; email?: string | null } | null;

export interface FeedbackDetail {
  state: string;
  annotations: { anchorExact: string | null; status: string; threadStatus: string; comments: { body: string; author?: Author }[] }[];
  reviews: { verdict: string; dismissed: boolean; reviewer?: Author }[];
}

export type Decision = "pending" | "approved" | "changes_requested";

function decisionFor(state: string): Decision {
  if (state === "CHANGES_REQUESTED") return "changes_requested";
  if (state === "APPROVED") return "approved";
  return "pending";
}

function authorName(a: Author): string {
  return a?.name ?? a?.email ?? "someone";
}

export function consolidateFeedback(detail: FeedbackDetail) {
  const threads = detail.annotations.map((a) => ({
    quote: a.anchorExact,
    status: a.status,
    threadStatus: a.threadStatus,
    comments: a.comments.map((c) => ({ author: authorName(c.author ?? null), body: c.body })),
  }));
  const reviews = detail.reviews.map((r) => ({ reviewer: authorName(r.reviewer ?? null), verdict: r.verdict, dismissed: r.dismissed }));
  const decision = decisionFor(detail.state);

  const lines: string[] = [`# Review feedback — decision: ${decision}`, ""];
  if (threads.length === 0) lines.push("_No inline comments._", "");
  for (const t of threads) {
    const tags = `${t.status === "ORPHANED" ? " (orphaned)" : t.status === "MOVED" ? " (moved)" : ""}${t.threadStatus === "RESOLVED" ? " [resolved]" : ""}`;
    lines.push(`## On "${t.quote ?? "(unanchored)"}"${tags}`);
    for (const c of t.comments) lines.push(`- **${c.author}:** ${c.body}`);
    lines.push("");
  }
  if (reviews.length) {
    lines.push("## Verdicts");
    for (const r of reviews) lines.push(`- ${r.reviewer}: ${r.verdict}${r.dismissed ? " (dismissed)" : ""}`);
  }

  return { decision, state: detail.state, markdown: lines.join("\n"), threads, reviews };
}

export async function getPlanFeedback(documentId: string) {
  const detail = await getDocumentDetail(documentId);
  if (!detail) return null;
  return consolidateFeedback(detail as unknown as FeedbackDetail);
}
```

- [ ] **Step 2: Test** `tests/unit/feedback.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { consolidateFeedback } from "@/lib/feedback";

describe("consolidateFeedback", () => {
  it("is pending with no comments", () => {
    const r = consolidateFeedback({ state: "OPEN", annotations: [], reviews: [] });
    expect(r.decision).toBe("pending");
    expect(r.markdown).toContain("No inline comments");
  });

  it("summarizes threads and derives changes_requested", () => {
    const r = consolidateFeedback({
      state: "CHANGES_REQUESTED",
      annotations: [{ anchorExact: "cloud setup", status: "ACTIVE", threadStatus: "OPEN", comments: [{ body: "which provider?", author: { name: "Reviewer" } }] }],
      reviews: [{ verdict: "REQUEST_CHANGES", dismissed: false, reviewer: { name: "Reviewer" } }],
    });
    expect(r.decision).toBe("changes_requested");
    expect(r.markdown).toContain("cloud setup");
    expect(r.markdown).toContain("which provider?");
    expect(r.threads).toHaveLength(1);
    expect(r.reviews[0].verdict).toBe("REQUEST_CHANGES");
  });

  it("derives approved", () => {
    const r = consolidateFeedback({ state: "APPROVED", annotations: [], reviews: [{ verdict: "APPROVE", dismissed: false, reviewer: { email: "a@x.com" } }] });
    expect(r.decision).toBe("approved");
  });
});
```

- [ ] **Step 3:** `pnpm test:unit -- tests/unit/feedback.test.ts` → PASS.

- [ ] **Step 4:** Commit:
```bash
command git add lib/feedback.ts tests/unit/feedback.test.ts
command git commit -m "feat: add feedback consolidation"
```

---

### Task 4: `createDocument` options + `requireApiUser`

**Goal:** Let `createDocument` set `source`/`agentContext`, and add Bearer-token auth helper `requireApiUser`.

**Files:**
- Modify: `lib/documents.ts`, `lib/api.ts`, `tests/unit/documents.test.ts`

**Acceptance Criteria:**
- [ ] `createDocument(userId, title, markdown, { source: "CLAUDE_CODE", agentContext })` persists source + agentContext; defaults stay `WEB`/null
- [ ] `requireApiUser(req)` returns the user for a valid Bearer token, else `null`
- [ ] Existing documents test + a new source-option assertion pass

**Verify:** `pnpm test:unit -- tests/unit/documents.test.ts` → passes; `pnpm build` passes.

**Steps:**

- [ ] **Step 1:** In `lib/documents.ts`, add the import `import type { DocumentSource } from "@/lib/enums";` and change `createDocument`'s signature + first write:

```ts
export async function createDocument(
  userId: string,
  title: string,
  markdown: string,
  opts?: { source?: DocumentSource; agentContext?: string }
) {
  const doc = await prisma.document.create({
    data: { title, ownerId: userId, state: "OPEN", source: opts?.source ?? "WEB", agentContext: opts?.agentContext ?? null },
  });
  // ... unchanged: create v1 DocumentVersion, set currentVersionId, return doc.id
```
(Leave the rest of the function body unchanged.)

- [ ] **Step 2:** In `lib/api.ts`, add:

```ts
import { verifyToken } from "@/lib/tokens";

export async function requireApiUser(req: Request) {
  return verifyToken(req.headers.get("authorization"));
}
```

- [ ] **Step 3:** Append a source-option assertion to `tests/unit/documents.test.ts` (inside the existing `describe`):

```ts
  it("records source and agentContext", async () => {
    const user = await makeUser();
    const id = await createDocument(user.id, "Plan", "body", { source: "CLAUDE_CODE", agentContext: "ctx" });
    const detail = await getDocumentDetail(id);
    expect(detail?.source).toBe("CLAUDE_CODE");
    expect(detail?.agentContext).toBe("ctx");
    await prisma.document.delete({ where: { id } });
  });
```

- [ ] **Step 4:** `pnpm test:unit -- tests/unit/documents.test.ts` → PASS; `pnpm build` → passes.

- [ ] **Step 5:** Commit:
```bash
command git add lib/documents.ts lib/api.ts tests/unit/documents.test.ts
command git commit -m "feat: add document source option and bearer auth helper"
```

---

### Task 5: Notifications service + wiring

**Goal:** Participant-based notification fan-out + read helpers, wired (best-effort) into the four mutation services.

**Files:**
- Create: `lib/notifications.ts`, `tests/unit/notifications.test.ts`
- Modify: `lib/annotations.ts` (addComment, setThreadStatus), `lib/reviews.ts` (submitReview), `lib/versions.ts` (createVersion), `app/api/annotations/[id]/route.ts` (setThreadStatus signature change)

**Acceptance Criteria:**
- [ ] `notifyParticipants(documentId, actorId, type)` inserts one notification per participant (owner + annotation/comment/review authors), excluding the actor
- [ ] `listNotifications` returns unread-first newest-first (≤50) with document title; `markRead`/`markAllRead`/`unreadCount` work
- [ ] The four mutation services call `notifyParticipants` best-effort (a notify failure does not fail the mutation)

**Verify:** `pnpm test:unit -- tests/unit/notifications.test.ts` → passes; `pnpm test:unit` (all) passes.

**Steps:**

- [ ] **Step 1: Implement** `lib/notifications.ts`:

```ts
import { prisma } from "@/lib/db";

export async function notifyParticipants(documentId: string, actorId: string, type: string) {
  const [doc, annotations, comments, reviews] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { ownerId: true } }),
    prisma.annotation.findMany({ where: { documentId }, select: { authorId: true } }),
    prisma.comment.findMany({ where: { annotation: { documentId } }, select: { authorId: true } }),
    prisma.review.findMany({ where: { documentId }, select: { reviewerId: true } }),
  ]);
  if (!doc) return;
  const ids = new Set<string>([doc.ownerId]);
  for (const a of annotations) ids.add(a.authorId);
  for (const c of comments) ids.add(c.authorId);
  for (const r of reviews) ids.add(r.reviewerId);
  ids.delete(actorId);
  if (ids.size === 0) return;
  await prisma.notification.createMany({ data: [...ids].map((userId) => ({ userId, documentId, actorId, type })) });
}

export async function listNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: [{ read: "asc" }, { createdAt: "desc" }],
    take: 50,
    include: { document: { select: { title: true } } },
  });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}

export async function markRead(userId: string, id: string) {
  await prisma.notification.updateMany({ where: { id, userId }, data: { read: true } });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
}
```

- [ ] **Step 2: Wire into services.** Add `import { notifyParticipants } from "@/lib/notifications";` to each, and call best-effort after the existing `publish(...)`:

In `lib/annotations.ts` `addComment` (just before `return comment;`):
```ts
  if (ann) await notifyParticipants(ann.documentId, userId, "comment").catch(() => {});
```
In `lib/annotations.ts` change `setThreadStatus` to take the actor and notify:
```ts
export async function setThreadStatus(userId: string, annotationId: string, status: ThreadStatus) {
  const annotation = await prisma.annotation.update({ where: { id: annotationId }, data: { threadStatus: status } });
  publish(annotation.documentId, { type: "annotation.updated", annotationId, threadStatus: status });
  await notifyParticipants(annotation.documentId, userId, "resolve").catch(() => {});
  return annotation;
}
```
In `app/api/annotations/[id]/route.ts`, update the call to pass the user: `await setThreadStatus(user.id, id, body.threadStatus as ThreadStatus);`
In `lib/reviews.ts` `submitReview` (just before `return state;`):
```ts
  await notifyParticipants(documentId, userId, "review").catch(() => {});
```
In `lib/versions.ts` `createVersion` (just before `return { unchanged: false ... }`, after `publish(...)`):
```ts
  await notifyParticipants(documentId, userId, "version").catch(() => {});
```

- [ ] **Step 3: Fix the Part 2 annotations test call.** In `tests/unit/annotations.test.ts`, the existing call `setThreadStatus(ann.id, "RESOLVED")` must become `setThreadStatus(user.id, ann.id, "RESOLVED")`.

- [ ] **Step 4: Test** `tests/unit/notifications.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation } from "@/lib/annotations";
import { submitReview } from "@/lib/reviews";
import { buildQuote } from "@/lib/anchoring";
import { notifyParticipants, listNotifications, unreadCount, markAllRead } from "@/lib/notifications";

async function makeUser() {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: "U", email: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("notifications", () => {
  it("notifies participants except the actor", async () => {
    const owner = await makeUser();
    const reviewer = await makeUser();
    const md = "The cloud setup needs review.";
    const docId = await createDocument(owner.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    await createAnnotation(owner.id, docId, { quote: buildQuote(md, start, start + 11), startOffset: start, endOffset: start + 11 }, "note");
    await submitReview(reviewer.id, docId, "APPROVE");

    // actor = reviewer ⇒ only the owner (a participant via ownership + annotation) is notified.
    await notifyParticipants(docId, reviewer.id, "review");
    expect(await unreadCount(owner.id)).toBeGreaterThanOrEqual(1);
    const list = await listNotifications(owner.id);
    expect(list[0].document.title).toBe("Plan");
    expect(list.some((n) => n.userId === reviewer.id)).toBe(false);

    await markAllRead(owner.id);
    expect(await unreadCount(owner.id)).toBe(0);
    await prisma.document.delete({ where: { id: docId } });
  });
});
```

- [ ] **Step 5:** `pnpm test:unit` (all) → PASS (includes the fixed annotations test).

- [ ] **Step 6:** Commit:
```bash
command git add lib/notifications.ts tests/unit/notifications.test.ts lib/annotations.ts lib/reviews.ts lib/versions.ts app/api/annotations/[id]/route.ts tests/unit/annotations.test.ts
command git commit -m "feat: add participant notifications and wire into mutations"
```

---

### Task 6: Machine API routes (`/api/plans`)

**Goal:** Bearer-authenticated plan endpoints: create, revise, and fetch consolidated feedback.

**Files:**
- Create: `app/api/plans/route.ts`, `app/api/plans/[id]/route.ts`, `app/api/plans/[id]/feedback/route.ts`

**Acceptance Criteria:**
- [ ] `POST /api/plans` (Bearer) creates a `CLAUDE_CODE` document and returns `{ id, reviewUrl }`; 401/400
- [ ] `PATCH /api/plans/:id` (Bearer) creates a new version (409 on stale base); 401/400
- [ ] `GET /api/plans/:id/feedback` (Bearer) returns the consolidated payload; 401/404
- [ ] `pnpm build` passes

**Verify:** `pnpm build` passes; routes listed. (Behaviour proven by Task 11 e2e.)

**Steps:**

- [ ] **Step 1:** `app/api/plans/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { createDocument } from "@/lib/documents";

export async function POST(req: Request) {
  const user = await requireApiUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || typeof body.markdown !== "string") {
    return NextResponse.json({ error: "title and markdown required" }, { status: 400 });
  }
  const agentContext = typeof body.agentContext === "string" ? body.agentContext : undefined;
  const id = await createDocument(user.id, body.title, body.markdown, { source: "CLAUDE_CODE", agentContext });
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return NextResponse.json({ id, reviewUrl: `${base}/app/documents/${id}` }, { status: 201 });
}
```

- [ ] **Step 2:** `app/api/plans/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { createVersion, ConcurrencyError } from "@/lib/versions";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser(req);
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

- [ ] **Step 3:** `app/api/plans/[id]/feedback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { getPlanFeedback } from "@/lib/feedback";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const feedback = await getPlanFeedback(id);
  if (!feedback) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(feedback);
}
```

- [ ] **Step 4:** `pnpm build` → passes; confirm `/api/plans`, `/api/plans/[id]`, `/api/plans/[id]/feedback` in the route list.

- [ ] **Step 5:** Commit:
```bash
command git add "app/api/plans"
command git commit -m "feat: add bearer-token machine API for plans"
```

---

### Task 7: Token API + Settings UI

**Goal:** Session-authed token CRUD + a Settings→API-tokens page that creates/revokes tokens and renders the CLI setup snippet.

**Files:**
- Create: `app/api/tokens/route.ts`, `app/api/tokens/[id]/route.ts`, `app/app/settings/tokens/page.tsx`, `components/TokenManager.tsx`

**Acceptance Criteria:**
- [ ] `POST /api/tokens` returns `{ id, token }` once; `GET /api/tokens` lists without hashes; `DELETE /api/tokens/:id` revokes — all session-guarded (401)
- [ ] The page lists tokens, creates one (showing the plaintext once in a copy field), revokes, and shows the `QUORUM_API_TOKEN`/`QUORUM_BASE_URL` setup snippet
- [ ] `pnpm build` passes

**Verify:** `pnpm build` passes. (Behaviour proven by Task 11 e2e.)

**Steps:**

- [ ] **Step 1:** `app/api/tokens/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { generateToken, listTokens } from "@/lib/tokens";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ tokens: await listTokens(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.label !== "string" || !body.label.trim()) {
    return NextResponse.json({ error: "label required" }, { status: 400 });
  }
  const { id, token } = await generateToken(user.id, body.label.trim());
  return NextResponse.json({ id, token }, { status: 201 });
}
```

- [ ] **Step 2:** `app/api/tokens/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { revokeToken } from "@/lib/tokens";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await revokeToken(user.id, id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3:** `app/app/settings/tokens/page.tsx` (server): fetch `listTokens(session.user.id)` directly and render `<TokenManager initialTokens={...} baseUrl={process.env.BETTER_AUTH_URL ?? ""} />`. Use `getSession()` from `@/lib/session` for the user id.

- [ ] **Step 4:** `components/TokenManager.tsx` (client). Contract:
  - Props: `initialTokens: { id, label, lastUsedAt, createdAt }[]`, `baseUrl: string`.
  - State: `tokens`, `label` input, `created` (the one-time plaintext or null).
  - Create: input `aria-label="token label"`, button "Create token" → `POST /api/tokens` → on 201 show the returned `token` in a readonly box with `data-testid="new-token"` and prepend `{id,label}` to the list; clear via a "Done" button.
  - Each token row: label, lastUsedAt, a "Revoke" button → `DELETE /api/tokens/${id}` → remove from list.
  - Below the list, a static **setup snippet** block (`<pre>`):
    ```
    export QUORUM_BASE_URL="<baseUrl>"
    export QUORUM_API_TOKEN="qai_…"   # the token shown above
    # /push-plan and /pull-feedback ship in this repo's .claude/commands/
    ```
  - Heading "API tokens".

- [ ] **Step 5:** `pnpm build` → passes.

- [ ] **Step 6:** Commit:
```bash
command git add "app/api/tokens" app/app/settings/tokens/page.tsx components/TokenManager.tsx
command git commit -m "feat: add api token management UI"
```

---

### Task 8: Notifications API + inbox + header badge

**Goal:** List/mark notifications, an inbox page, and an unread badge in the app header.

**Files:**
- Create: `app/api/notifications/route.ts`, `app/app/inbox/page.tsx`, `components/InboxList.tsx`
- Modify: `app/app/layout.tsx` (header bell + unread count)

**Acceptance Criteria:**
- [ ] `GET /api/notifications` returns the current user's notifications; `PATCH /api/notifications` with `{ id }` or `{ all: true }` marks read — session-guarded (401)
- [ ] `/app/inbox` lists notifications (type, document title, time), each deep-linking to `/app/documents/:id` and marking read on open
- [ ] The header shows an unread count linking to `/app/inbox`
- [ ] `pnpm build` passes

**Verify:** `pnpm build` passes. (Behaviour proven by Task 11 e2e.)

**Steps:**

- [ ] **Step 1:** `app/api/notifications/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { listNotifications, markRead, markAllRead } from "@/lib/notifications";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ notifications: await listNotifications(user.id) });
}

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (body?.all === true) { await markAllRead(user.id); return NextResponse.json({ ok: true }); }
  if (typeof body?.id === "string") { await markRead(user.id, body.id); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "id or all required" }, { status: 400 });
}
```

- [ ] **Step 2:** `app/app/inbox/page.tsx` (server): fetch `listNotifications(session.user.id)` directly; render `<InboxList initial={...} />`. A short label map: `comment→"New comment"`, `review→"New verdict"`, `version→"New version"`, `resolve→"Thread resolved"`.

- [ ] **Step 3:** `components/InboxList.tsx` (client). Contract:
  - Props: `initial: { id, type, documentId, read, createdAt, document: { title } }[]`.
  - Renders a list, each row `data-testid="notification"`: a `<Link href={/app/documents/${n.documentId}}>` showing the type label + document title; unread rows visually emphasized.
  - On click, `PATCH /api/notifications` with `{ id }` (fire-and-forget) before navigation (use `onClick`), and optimistically mark the row read.
  - A "Mark all read" button → `PATCH { all: true }`.

- [ ] **Step 4:** Modify `app/app/layout.tsx` — it's a server component with `session`. Import `unreadCount` from `@/lib/notifications`, compute `const unread = await unreadCount(session.user.id);`, and add to the header (before `current-user`):
```tsx
<a href="/app/inbox" data-testid="inbox-link" className="text-sm underline">
  Inbox{unread > 0 ? ` (${unread})` : ""}
</a>
```

- [ ] **Step 5:** `pnpm build` → passes.

- [ ] **Step 6:** Commit:
```bash
command git add "app/api/notifications" app/app/inbox/page.tsx components/InboxList.tsx app/app/layout.tsx
command git commit -m "feat: add notifications inbox and header badge"
```

---

### Task 9: CLI commands (`/push-plan`, `/pull-feedback`)

**Goal:** Ship the two Claude Code commands in-repo so an agent can push a plan and pull feedback against a Quorum instance.

**Files:**
- Create: `.claude/commands/push-plan.md`, `.claude/commands/pull-feedback.md`

**Acceptance Criteria:**
- [ ] `push-plan.md` posts a plan to `POST $QUORUM_BASE_URL/api/plans` with the Bearer token and prints the review URL + id
- [ ] `pull-feedback.md` GETs `…/api/plans/<id>/feedback` and injects the `markdown` digest, reporting `decision`
- [ ] Both have valid frontmatter (`allowed-tools`, `description`)

**Verify:** Files exist with the documented structure; `command git status` shows them staged. (Manual dogfooding against a running instance is the real test; not in CI.)

**Steps:**

- [ ] **Step 1:** Create `.claude/commands/push-plan.md`:

```markdown
---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(jq:*)
description: Push the current plan to a Quorum AI instance for team review (returns control immediately).
---

Post a plan to Quorum AI for asynchronous team review, then return control to the user (do NOT block waiting for feedback).

Requires env vars: `QUORUM_BASE_URL` (e.g. http://localhost:3000) and `QUORUM_API_TOKEN` (from Quorum → Settings → API tokens).

1. Determine the plan markdown: if `$ARGUMENTS` names a file, read it; otherwise use the most recent plan / your last assistant message.
2. Determine a title (first heading of the plan, else "Plan").
3. POST it:
   `curl -s -X POST "$QUORUM_BASE_URL/api/plans" -H "Authorization: Bearer $QUORUM_API_TOKEN" -H 'content-type: application/json' -d "$(jq -n --arg t "<title>" --arg m "<markdown>" '{title:$t, markdown:$m}')"`
4. Parse the JSON `{ id, reviewUrl }` and print both to the user: "Plan posted for review: <reviewUrl> (id <id>). I'll resume when you run /pull-feedback <id>."
5. Return control. Do not poll.
```

- [ ] **Step 2:** Create `.claude/commands/pull-feedback.md`:

```markdown
---
allowed-tools: Bash(curl:*), Bash(jq:*)
description: Pull consolidated team feedback for a Quorum AI plan and revise accordingly.
---

Fetch consolidated review feedback for a plan and use it to revise.

Requires env vars: `QUORUM_BASE_URL` and `QUORUM_API_TOKEN`. The plan id is `$ARGUMENTS`.

1. GET feedback:
   `curl -s "$QUORUM_BASE_URL/api/plans/$ARGUMENTS/feedback" -H "Authorization: Bearer $QUORUM_API_TOKEN"`
2. Parse `{ decision, state, markdown, threads, reviews }`.
3. If `decision` is "pending": tell the user no decision yet and stop.
4. Otherwise, present the `markdown` digest, then revise the plan to address every comment. If the user approves the revision, post it back with `PATCH $QUORUM_BASE_URL/api/plans/$ARGUMENTS` `{ markdown, baseVersionNumber }`.
```

- [ ] **Step 3:** Commit:
```bash
command git add .claude/commands/push-plan.md .claude/commands/pull-feedback.md
command git commit -m "feat: add push-plan and pull-feedback commands"
```

---

### Task 10: Packaging — conditional standalone + compose

**Goal:** Resolve the `output: standalone` vs `next start` mismatch (env-gate it) and add `docker-compose.yml`.

**Files:**
- Modify: `next.config.ts`, `Dockerfile`
- Create: `docker-compose.yml`

**Acceptance Criteria:**
- [ ] `next.config.ts` emits `standalone` only when `BUILD_STANDALONE` is set
- [ ] The Dockerfile builder sets `BUILD_STANDALONE=1` before `pnpm build`
- [ ] `docker-compose.yml` builds the image, mounts `/data`, maps `3000:3000`, passes auth env
- [ ] `pnpm build` (no env) passes WITHOUT the standalone warning; `pnpm test:e2e` still passes

**Verify:** `pnpm build` → no "next start does not work with output: standalone" warning; `pnpm test:e2e` → all pass.

**Steps:**

- [ ] **Step 1:** Edit `next.config.ts` — change the `output` line to:
```ts
  output: process.env.BUILD_STANDALONE ? "standalone" : undefined,
```
(Keep `serverExternalPackages` as-is.)

- [ ] **Step 2:** In `Dockerfile`, in the `builder` stage, add before `RUN pnpm build`:
```dockerfile
ENV BUILD_STANDALONE=1
```

- [ ] **Step 3:** Create `docker-compose.yml`:
```yaml
services:
  quorum:
    build: .
    ports:
      - "3000:3000"
    environment:
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-change-me-to-a-32+char-random-string}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:-http://localhost:3000}
    volumes:
      - quorum-data:/data
volumes:
  quorum-data:
```

- [ ] **Step 4:** `pnpm build` → passes with no standalone warning. Then `lsof -ti tcp:3000 | xargs -r kill -9; pnpm test:e2e` → all pass (webServer now uses plain `next start`).

- [ ] **Step 5:** Commit:
```bash
command git add next.config.ts Dockerfile docker-compose.yml
command git commit -m "feat: gate standalone build and add docker-compose"
```

---

### Task 11: E2E — machine API token flow + notifications

**Goal:** Prove the agent round-trip (token → push plan → feedback) and participant notifications end-to-end.

**Files:**
- Create: `tests/e2e/integration.spec.ts`

**Acceptance Criteria:**
- [ ] A user creates a token in Settings, then uses it (Bearer) to `POST /api/plans` → `{id, reviewUrl}` and `GET …/feedback` → `decision: "pending"`
- [ ] A comment by user B on user A's plan produces an inbox notification for A (unread badge + a `notification` row deep-linking to the doc)

**Verify:** `pnpm test:e2e -- tests/e2e/integration.spec.ts` → passes.

**Steps:**

- [ ] **Step 1:** Write `tests/e2e/integration.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<string> {
  const email = `int-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Integrator");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
  return email;
}

test("machine API: token → push plan → feedback", async ({ page, request }) => {
  await register(page);
  await page.goto("/app/settings/tokens");
  await page.getByLabel("token label").fill("ci");
  await page.getByRole("button", { name: "Create token" }).click();
  const token = await page.getByTestId("new-token").inputValue();
  expect(token.startsWith("qai_")).toBe(true);

  const post = await request.post("/api/plans", {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: "Agent Plan", markdown: "The cloud setup needs review." },
  });
  expect(post.status()).toBe(201);
  const { id, reviewUrl } = await post.json();
  expect(reviewUrl).toContain(`/app/documents/${id}`);

  const fb = await request.get(`/api/plans/${id}/feedback`, { headers: { Authorization: `Bearer ${token}` } });
  expect(fb.status()).toBe(200);
  expect((await fb.json()).decision).toBe("pending");

  const unauth = await request.get(`/api/plans/${id}/feedback`);
  expect(unauth.status()).toBe(401);
});

test("notifications: comment notifies the plan owner", async ({ browser }) => {
  // Owner A creates a plan via the UI.
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await register(pageA);
  await pageA.getByLabel("title").fill("Notify Plan");
  await pageA.getByLabel("markdown").fill("Shared content needing review.");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\//);
  const url = pageA.url();

  // Reviewer B comments on it.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await register(pageB);
  await pageB.goto(url);
  await pageB.getByTestId("doc-body").getByText("Shared content").first().selectText();
  await pageB.getByLabel("comment").fill("a question from B");
  await pageB.getByRole("button", { name: "Comment" }).click();
  await expect(pageB.getByTestId("thread")).toContainText("a question from B");

  // A sees an inbox notification.
  await pageA.goto("/app/inbox");
  await expect(pageA.getByTestId("notification").first()).toContainText("Notify Plan");

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 2:** Run: `lsof -ti tcp:3000 | xargs -r kill -9; pnpm test:e2e -- tests/e2e/integration.spec.ts` → expect `2 passed`.

- [ ] **Step 3:** Confirm the whole suite: `pnpm test:unit` (all pass) + `pnpm test:e2e` (all specs pass) + `pnpm build`.

- [ ] **Step 4:** Commit:
```bash
command git add tests/e2e/integration.spec.ts
command git commit -m "feat: add machine API and notifications e2e"
```

---

## Self-review
- **Spec coverage:** machine API POST/PATCH/feedback ✓(T6); token auth + management ✓(T2,T7); feedback consolidation ✓(T3); notifications model+fan-out+inbox ✓(T1,T5,T8); CLI commands in-repo ✓(T9); packaging env-gate + compose ✓(T10); `createDocument` source/agentContext + `requireApiUser` ✓(T4); e2e ✓(T11). Email/teams/version-browsing/live-notifications explicitly out of scope.
- **Placeholders:** none — libs/services/routes are complete code; UI tasks give component contracts with the exact `data-testid`s / aria-labels the e2e depends on (`token label`, `new-token`, `inbox-link`, `notification`).
- **Type/name consistency:** `generateToken`/`verifyToken`/`listTokens`/`revokeToken` (T2) used in T4/T6/T7; `requireApiUser` (T4) used in T6; `consolidateFeedback`/`getPlanFeedback`/`Decision` (T3) used in T6; `notifyParticipants`/`listNotifications`/`unreadCount`/`markRead`/`markAllRead` (T5) used in T8; `createDocument` 4th-arg options (T4) used in T6; `setThreadStatus(userId, …)` signature change (T5) updates the annotations route + Part 2 test; `data-testid`s/labels align between T7/T8 UI and the T11 e2e.

## Notes for later
- Email notifications (SMTP, env-gated) — the `Notification` rows already capture what to send.
- Teams/org model → richer participant/notification targeting.
- Historical-version browsing/diff view (deferred from Part 2).
- Live inbox via a user-scoped SSE channel if real-time notification UX is wanted.
