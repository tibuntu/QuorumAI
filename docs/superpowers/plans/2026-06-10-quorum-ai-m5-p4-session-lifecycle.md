# M5 Phase 4 — Session Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit, ephemeral review-session layer to a document — any participant can start one, it has a single leader and an explicit-join participant list distinct from ambient presence, and it ends when the leader ends it or disconnects.

**Architecture:** A dedicated in-memory `lib/review-session.ts` registry (sibling to `lib/presence.ts`, `globalThis`-stashed, env-tunable sweep), reusing the existing `lib/events.ts` SSE event bus. A thin action route drives lifecycle; the existing document SSE stream carries `session.started`/`session.updated`/`session.ended` events and replays an active session on connect. A pure client reducer feeds a `SessionBanner` rendered inside `DocumentView`. Zero new dependencies, zero new processes, no third `EventSource`.

**Tech Stack:** Next.js (App Router, standalone), TypeScript, React 19, Node `EventEmitter` event bus, Vitest (unit), Playwright (e2e), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-10-quorum-ai-m5-p4-session-lifecycle-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/events.ts` (modify) | `SessionParticipant`/`ReviewSession` types + 3 `DocEvent` variants |
| `lib/enums.ts` (modify) | `SESSION_ACTIONS` value-set |
| `lib/review-session.ts` (create) | In-memory session registry, lifecycle fns, leader-drop sweep |
| `app/api/documents/[id]/session/route.ts` (create) | `POST` action route (start/join/leave/end) |
| `app/api/documents/[id]/stream/route.ts` (modify) | Replay active session as `session.started` on connect |
| `lib/session-client.ts` (create) | Pure reducer + predicates for client state |
| `components/SessionBanner.tsx` (create) | Header UI, four states |
| `components/DocumentView.tsx` (modify) | Session state, event switch, POST actions, render banner |
| `tests/unit/review-session.test.ts` (create) | Registry semantics + sweep |
| `tests/unit/session-client.test.ts` (create) | Reducer + predicates |
| `tests/unit/session.route.test.ts` (create) | Route authz + status codes |
| `tests/unit/stream.session-sync.test.ts` (create) | Active-session replay on connect |
| `tests/e2e/sessions.spec.ts` (create) | Two-context lifecycle + EventSource invariant |

---

## Task 1: Session types & action enum

**Goal:** Add the `ReviewSession`/`SessionParticipant` types and the three `session.*` events to the `DocEvent` union, plus the `SESSION_ACTIONS` value-set — the shared foundation every later task imports.

**Files:**
- Modify: `lib/events.ts` (after the `PresenceEntry` interface, ~`:23-29`; and the `DocEvent` union, ~`:31-43`)
- Modify: `lib/enums.ts` (append at end)
- Test: `tests/unit/enums.session.test.ts` (create)

**Acceptance Criteria:**
- [ ] `ReviewSession` and `SessionParticipant` are exported from `lib/events.ts`.
- [ ] `DocEvent` includes `session.started`, `session.updated`, `session.ended`.
- [ ] `SESSION_ACTIONS` exported from `lib/enums.ts` as `["start", "join", "leave", "end"]` with a `SessionAction` type.
- [ ] `npx tsc --noEmit` is clean.

**Verify:** `CI=true npx vitest run tests/unit/enums.session.test.ts` → PASS; `npx tsc --noEmit` → no errors.

**Steps:**

- [ ] **Step 1: Add the value-set test (failing)**

Create `tests/unit/enums.session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SESSION_ACTIONS } from "@/lib/enums";

describe("SESSION_ACTIONS", () => {
  it("is the exact start/join/leave/end set", () => {
    expect([...SESSION_ACTIONS]).toEqual(["start", "join", "leave", "end"]);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `CI=true npx vitest run tests/unit/enums.session.test.ts`
Expected: FAIL — `SESSION_ACTIONS` is not exported.

- [ ] **Step 3: Append the enum to `lib/enums.ts`**

```ts
export const SESSION_ACTIONS = ["start", "join", "leave", "end"] as const;
export type SessionAction = (typeof SESSION_ACTIONS)[number];
```

- [ ] **Step 4: Add the types and events to `lib/events.ts`**

After the `PresenceEntry` interface, add:

```ts
export interface SessionParticipant {
  userId: string;
  name: string;
  joinedAt: number; // epoch ms
}

export interface ReviewSession {
  sessionId: string; // crypto.randomUUID()
  documentId: string;
  leaderId: string;
  leaderName: string;
  participants: SessionParticipant[]; // includes the leader; ordered by joinedAt
  startedAt: number; // epoch ms
}
```

Extend the `DocEvent` union (add these three members before the closing `;`):

```ts
  | { type: "session.started"; session: ReviewSession }
  | { type: "session.updated"; session: ReviewSession }
  | { type: "session.ended" }
```

- [ ] **Step 5: Verify**

Run: `CI=true npx vitest run tests/unit/enums.session.test.ts` → PASS
Run: `npx tsc --noEmit` → no errors

- [ ] **Step 6: Commit**

```bash
rtk git add lib/events.ts lib/enums.ts tests/unit/enums.session.test.ts
rtk git commit -m "feat(m5-p4): session types, events, and action enum"
```

---

## Task 2: Review-session registry & leader-drop sweep

**Goal:** Implement `lib/review-session.ts` — the in-memory session registry with start/join/leave/end lifecycle and the leader-drop / participant-prune sweep that reads `presence.roster()`.

**Files:**
- Create: `lib/review-session.ts`
- Test: `tests/unit/review-session.test.ts`

**Acceptance Criteria:**
- [ ] `startSession` creates a session with the leader auto-joined and emits `session.started`; a second start for the same doc returns `null` (one-at-a-time) and emits nothing.
- [ ] `joinSession` appends a participant and emits `session.updated`; a repeat join for the same user is an idempotent no-op (no duplicate, no extra event).
- [ ] Non-leader `leaveSession` removes the participant and emits `session.updated`; leader `leaveSession` ends the session (emits `session.ended`).
- [ ] `endSession` returns `false` and emits nothing when called by a non-leader; returns `true` and emits `session.ended` for the leader.
- [ ] `evictStaleSessions` ends a session whose leader is absent from the presence roster, and prunes non-leader participants who left the roster (single `session.updated`).
- [ ] `getSession` returns the snapshot or `null`.

**Verify:** `CI=true npx vitest run tests/unit/review-session.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/review-session.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { subscribe, type DocEvent } from "@/lib/events";
import {
  startSession, joinSession, leaveSession, endSession, getSession, evictStaleSessions,
} from "@/lib/review-session";
import * as presence from "@/lib/presence";

function capture(docId: string): { events: DocEvent[]; stop: () => void } {
  const events: DocEvent[] = [];
  const stop = subscribe(docId, (e) => events.push(e));
  return { events, stop };
}
const leader = { userId: "lead", name: "Ada" };

afterEach(() => vi.restoreAllMocks());

describe("review-session registry", () => {
  it("startSession creates a session with the leader joined and emits session.started", () => {
    const { events, stop } = capture("s-doc-1");
    const s = startSession("s-doc-1", leader);
    expect(s).not.toBeNull();
    expect(s!.leaderId).toBe("lead");
    expect(s!.participants.map((p) => p.userId)).toEqual(["lead"]);
    expect(events).toContainEqual(expect.objectContaining({ type: "session.started" }));
    stop();
    endSession("s-doc-1", "lead");
  });

  it("rejects a second concurrent session for the same document", () => {
    startSession("s-doc-2", leader);
    const { events, stop } = capture("s-doc-2");
    const second = startSession("s-doc-2", { userId: "other", name: "Bo" });
    expect(second).toBeNull();
    expect(events).toHaveLength(0);
    stop();
    endSession("s-doc-2", "lead");
  });

  it("joinSession appends a participant and emits session.updated; repeat join is a no-op", () => {
    startSession("s-doc-3", leader);
    const { events, stop } = capture("s-doc-3");
    joinSession("s-doc-3", { userId: "u2", name: "Grace" });
    expect(getSession("s-doc-3")!.participants.map((p) => p.userId)).toEqual(["lead", "u2"]);
    joinSession("s-doc-3", { userId: "u2", name: "Grace" }); // idempotent
    expect(getSession("s-doc-3")!.participants.filter((p) => p.userId === "u2")).toHaveLength(1);
    expect(events.filter((e) => e.type === "session.updated")).toHaveLength(1);
    stop();
    endSession("s-doc-3", "lead");
  });

  it("non-leader leaveSession removes them; leader leaveSession ends the session", () => {
    startSession("s-doc-4", leader);
    joinSession("s-doc-4", { userId: "u2", name: "Grace" });
    leaveSession("s-doc-4", "u2");
    expect(getSession("s-doc-4")!.participants.map((p) => p.userId)).toEqual(["lead"]);
    leaveSession("s-doc-4", "lead");
    expect(getSession("s-doc-4")).toBeNull();
  });

  it("endSession is leader-only", () => {
    startSession("s-doc-5", leader);
    const { events, stop } = capture("s-doc-5");
    expect(endSession("s-doc-5", "u2")).toBe(false);
    expect(events).toHaveLength(0);
    expect(endSession("s-doc-5", "lead")).toBe(true);
    expect(events).toContainEqual({ type: "session.ended" });
    expect(getSession("s-doc-5")).toBeNull();
    stop();
  });

  it("evictStaleSessions ends sessions whose leader left the roster", () => {
    startSession("s-doc-6", leader);
    vi.spyOn(presence, "roster").mockReturnValue([]); // nobody present
    evictStaleSessions();
    expect(getSession("s-doc-6")).toBeNull();
  });

  it("evictStaleSessions prunes participants who left the roster", () => {
    startSession("s-doc-7", leader);
    joinSession("s-doc-7", { userId: "u2", name: "Grace" });
    vi.spyOn(presence, "roster").mockReturnValue([
      { userId: "lead", name: "Ada", lastSeen: Date.now() },
    ]); // leader present, u2 gone
    const { events, stop } = capture("s-doc-7");
    evictStaleSessions();
    expect(getSession("s-doc-7")!.participants.map((p) => p.userId)).toEqual(["lead"]);
    expect(events.filter((e) => e.type === "session.updated")).toHaveLength(1);
    stop();
    endSession("s-doc-7", "lead");
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `CI=true npx vitest run tests/unit/review-session.test.ts`
Expected: FAIL — `@/lib/review-session` not found.

- [ ] **Step 3: Implement `lib/review-session.ts`**

```ts
import { publish, type ReviewSession, type SessionParticipant } from "@/lib/events";
import { roster } from "@/lib/presence";

export type { ReviewSession, SessionParticipant };

type Registry = Map<string, ReviewSession>;

const globalForSession = globalThis as unknown as {
  reviewSessionRegistry?: Registry;
  reviewSessionSweep?: ReturnType<typeof setInterval>;
};

const registry: Registry = globalForSession.reviewSessionRegistry ?? new Map();
if (process.env.NODE_ENV !== "production") globalForSession.reviewSessionRegistry = registry;

/** Start a session led by `leader` (auto-joined). Returns null if one already exists. */
export function startSession(documentId: string, leader: { userId: string; name: string }): ReviewSession | null {
  if (registry.has(documentId)) return null;
  const now = Date.now();
  const session: ReviewSession = {
    sessionId: crypto.randomUUID(),
    documentId,
    leaderId: leader.userId,
    leaderName: leader.name,
    participants: [{ userId: leader.userId, name: leader.name, joinedAt: now }],
    startedAt: now,
  };
  registry.set(documentId, session);
  publish(documentId, { type: "session.started", session });
  return session;
}

/** Add a participant to the active session (idempotent). Returns null if no session. */
export function joinSession(documentId: string, user: { userId: string; name: string }): ReviewSession | null {
  const session = registry.get(documentId);
  if (!session) return null;
  if (session.participants.some((p) => p.userId === user.userId)) return session;
  session.participants.push({ userId: user.userId, name: user.name, joinedAt: Date.now() });
  publish(documentId, { type: "session.updated", session });
  return session;
}

/** Remove a non-leader participant; if the leader leaves, the session ends. No-op if absent. */
export function leaveSession(documentId: string, userId: string): void {
  const session = registry.get(documentId);
  if (!session) return;
  if (userId === session.leaderId) {
    endSession(documentId, userId);
    return;
  }
  const before = session.participants.length;
  session.participants = session.participants.filter((p) => p.userId !== userId);
  if (session.participants.length !== before) publish(documentId, { type: "session.updated", session });
}

/** End the session. Only the leader may end it; returns false otherwise. */
export function endSession(documentId: string, userId: string): boolean {
  const session = registry.get(documentId);
  if (!session) return false;
  if (userId !== session.leaderId) return false;
  registry.delete(documentId);
  publish(documentId, { type: "session.ended" });
  return true;
}

/** Current session snapshot for a document, or null. */
export function getSession(documentId: string): ReviewSession | null {
  return registry.get(documentId) ?? null;
}

/** End sessions whose leader left the presence roster; prune departed participants. */
export function evictStaleSessions(): void {
  const endedDocs: string[] = [];
  for (const [documentId, session] of registry) {
    const present = new Set(roster(documentId).map((e) => e.userId));
    if (!present.has(session.leaderId)) {
      endedDocs.push(documentId);
      continue;
    }
    const kept = session.participants.filter((p) => present.has(p.userId));
    if (kept.length !== session.participants.length) {
      session.participants = kept;
      publish(documentId, { type: "session.updated", session });
    }
  }
  for (const documentId of endedDocs) {
    registry.delete(documentId);
    publish(documentId, { type: "session.ended" });
  }
}

// One process-wide sweep, guarded so dev hot-reload doesn't spawn duplicates.
if (!globalForSession.reviewSessionSweep) {
  const sweepMs = Number(process.env.SESSION_SWEEP_MS ?? 10_000);
  const timer = setInterval(evictStaleSessions, sweepMs);
  timer.unref?.();
  globalForSession.reviewSessionSweep = timer;
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `CI=true npx vitest run tests/unit/review-session.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
rtk git add lib/review-session.ts tests/unit/review-session.test.ts
rtk git commit -m "feat(m5-p4): in-memory review-session registry with leader-drop sweep"
```

---

## Task 3: Session action route

**Goal:** Implement `POST /api/documents/[id]/session` dispatching start/join/leave/end with auth, participant, and conflict handling.

**Files:**
- Create: `app/api/documents/[id]/session/route.ts`
- Test: `tests/unit/session.route.test.ts`

**Acceptance Criteria:**
- [ ] 401 unauthenticated; 404 non-participant; 400 for an unknown/missing action.
- [ ] `start` → 200 `{ session }`; 409 when a session already exists.
- [ ] `join` → 200 `{ session }`; 409 when no session exists.
- [ ] `leave` → 204.
- [ ] `end` → 204 for the leader; 403 for a non-leader.
- [ ] Display name resolves `name.trim() || email || "Someone"` (same as the presence route).

**Verify:** `CI=true npx vitest run tests/unit/session.route.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/session.route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/authz", () => ({ isParticipant: vi.fn() }));
vi.mock("@/lib/review-session", () => ({
  startSession: vi.fn(), joinSession: vi.fn(), leaveSession: vi.fn(), endSession: vi.fn(),
}));

import { POST } from "@/app/api/documents/[id]/session/route";
import * as api from "@/lib/api";
import * as authz from "@/lib/authz";
import * as session from "@/lib/review-session";

function req(body?: unknown): Request {
  return new Request("http://test/api/documents/doc1/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: "doc1" }) };
const user = { id: "u1", name: "Ada", email: "a@b.co" };
const fakeSession = { sessionId: "s1", documentId: "doc1", leaderId: "u1", leaderName: "Ada", participants: [], startedAt: 1 };

function auth(ok = true) {
  vi.mocked(api.requireUser).mockResolvedValueOnce(user as never);
  vi.mocked(authz.isParticipant).mockResolvedValueOnce(ok);
}

describe("POST /api/documents/[id]/session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    expect((await POST(req({ action: "start" }), ctx)).status).toBe(401);
  });

  it("404 when not a participant", async () => {
    auth(false);
    expect((await POST(req({ action: "start" }), ctx)).status).toBe(404);
  });

  it("400 for an unknown action", async () => {
    auth();
    expect((await POST(req({ action: "frobnicate" }), ctx)).status).toBe(400);
  });

  it("start returns 200 with the session", async () => {
    auth();
    vi.mocked(session.startSession).mockReturnValueOnce(fakeSession as never);
    const res = await POST(req({ action: "start" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: fakeSession });
    expect(session.startSession).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" });
  });

  it("start returns 409 when a session already exists", async () => {
    auth();
    vi.mocked(session.startSession).mockReturnValueOnce(null);
    expect((await POST(req({ action: "start" }), ctx)).status).toBe(409);
  });

  it("join returns 200 with the session", async () => {
    auth();
    vi.mocked(session.joinSession).mockReturnValueOnce(fakeSession as never);
    expect((await POST(req({ action: "join" }), ctx)).status).toBe(200);
  });

  it("join returns 409 when no session exists", async () => {
    auth();
    vi.mocked(session.joinSession).mockReturnValueOnce(null);
    expect((await POST(req({ action: "join" }), ctx)).status).toBe(409);
  });

  it("leave returns 204", async () => {
    auth();
    const res = await POST(req({ action: "leave" }), ctx);
    expect(res.status).toBe(204);
    expect(session.leaveSession).toHaveBeenCalledWith("doc1", "u1");
  });

  it("end returns 204 for the leader", async () => {
    auth();
    vi.mocked(session.endSession).mockReturnValueOnce(true);
    expect((await POST(req({ action: "end" }), ctx)).status).toBe(204);
  });

  it("end returns 403 for a non-leader", async () => {
    auth();
    vi.mocked(session.endSession).mockReturnValueOnce(false);
    expect((await POST(req({ action: "end" }), ctx)).status).toBe(403);
  });

  it("falls back to email for a blank name", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "", email: "a@b.co" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    vi.mocked(session.startSession).mockReturnValueOnce(fakeSession as never);
    await POST(req({ action: "start" }), ctx);
    expect(session.startSession).toHaveBeenCalledWith("doc1", { userId: "u1", name: "a@b.co" });
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `CI=true npx vitest run tests/unit/session.route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement `app/api/documents/[id]/session/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { isParticipant } from "@/lib/authz";
import { startSession, joinSession, leaveSession, endSession } from "@/lib/review-session";
import { SESSION_ACTIONS, type SessionAction } from "@/lib/enums";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const action = body?.action as unknown;
  if (typeof action !== "string" || !SESSION_ACTIONS.includes(action as SessionAction)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }
  const name = (user.name && user.name.trim()) || user.email || "Someone";

  switch (action as SessionAction) {
    case "start": {
      const session = startSession(id, { userId: user.id, name });
      if (!session) return NextResponse.json({ error: "session already active" }, { status: 409 });
      return NextResponse.json({ session }, { status: 200 });
    }
    case "join": {
      const session = joinSession(id, { userId: user.id, name });
      if (!session) return NextResponse.json({ error: "no active session" }, { status: 409 });
      return NextResponse.json({ session }, { status: 200 });
    }
    case "leave": {
      leaveSession(id, user.id);
      return new Response(null, { status: 204 });
    }
    case "end": {
      if (!endSession(id, user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      return new Response(null, { status: 204 });
    }
  }
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `CI=true npx vitest run tests/unit/session.route.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
rtk git add "app/api/documents/[id]/session/route.ts" tests/unit/session.route.test.ts
rtk git commit -m "feat(m5-p4): session action route (start/join/leave/end)"
```

---

## Task 4: Replay active session on SSE connect

**Goal:** When a client connects to the document stream and a session is active, immediately send a `session.started` snapshot so late joiners see the in-progress session.

**Files:**
- Modify: `app/api/documents/[id]/stream/route.ts` (the `start(controller)` block, after the `presence.sync` enqueue, ~`:20-23`)
- Test: `tests/unit/stream.session-sync.test.ts`

**Acceptance Criteria:**
- [ ] On connect, if `getSession(id)` is non-null, the stream emits a `session.started` event carrying that snapshot.
- [ ] When no session is active, no `session.started` is emitted on connect (existing `presence.sync` behavior unchanged).

**Verify:** `CI=true npx vitest run tests/unit/stream.session-sync.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/stream.session-sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/authz", () => ({ isParticipant: vi.fn() }));

import { GET } from "@/app/api/documents/[id]/stream/route";
import * as api from "@/lib/api";
import * as authz from "@/lib/authz";
import { startSession, endSession } from "@/lib/review-session";

const ctx = { params: Promise.resolve({ id: "stream-sess-1" }) };

async function firstChunks(res: Response, n = 3): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (let i = 0; i < n; i++) buf += dec.decode((await reader.read()).value ?? new Uint8Array());
  await reader.cancel();
  return buf;
}

describe("GET /api/documents/[id]/stream session snapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replays an active session as session.started on connect", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "viewer" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    startSession("stream-sess-1", { userId: "lead", name: "Ada" });

    const res = await GET(new Request("http://test"), ctx);
    const buf = await firstChunks(res);
    expect(buf).toContain("session.started");
    expect(buf).toContain('"leaderId":"lead"');
    endSession("stream-sess-1", "lead");
  });

  it("emits no session.started when no session is active", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "viewer" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await GET(new Request("http://test"), { params: Promise.resolve({ id: "stream-sess-2" }) });
    const buf = await firstChunks(res);
    expect(buf).not.toContain("session.started");
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `CI=true npx vitest run tests/unit/stream.session-sync.test.ts`
Expected: FAIL — no `session.started` emitted yet.

- [ ] **Step 3: Modify the stream route**

In `app/api/documents/[id]/stream/route.ts`, add the import:

```ts
import { getSession } from "@/lib/review-session";
```

Inside `start(controller)`, immediately after the existing `presence.sync` enqueue line, add:

```ts
      const activeSession = getSession(id);
      if (activeSession) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "session.started", session: activeSession })}\n\n`)
        );
      }
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `CI=true npx vitest run tests/unit/stream.session-sync.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
rtk git add "app/api/documents/[id]/stream/route.ts" tests/unit/stream.session-sync.test.ts
rtk git commit -m "feat(m5-p4): replay active session on SSE connect"
```

---

## Task 5: Client session reducer & predicates

**Goal:** Implement `lib/session-client.ts` — a pure reducer and predicates the React layer uses to track session state.

**Files:**
- Create: `lib/session-client.ts`
- Test: `tests/unit/session-client.test.ts`

**Acceptance Criteria:**
- [ ] `applySessionEvent` sets state to `event.session` for `session.started` and `session.updated`, to `null` for `session.ended`, and returns the input unchanged for unrelated events.
- [ ] `isLeader(session, userId)` is true only when `session.leaderId === userId`.
- [ ] `isInSession(session, userId)` is true only when the user is in `participants`.
- [ ] `canStart(session)` is true only when `session === null`.

**Verify:** `CI=true npx vitest run tests/unit/session-client.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/session-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applySessionEvent, isLeader, isInSession, canStart } from "@/lib/session-client";
import type { ReviewSession } from "@/lib/events";

const session: ReviewSession = {
  sessionId: "s1", documentId: "d1", leaderId: "lead", leaderName: "Ada",
  participants: [
    { userId: "lead", name: "Ada", joinedAt: 1 },
    { userId: "u2", name: "Grace", joinedAt: 2 },
  ],
  startedAt: 1,
};

describe("applySessionEvent", () => {
  it("started and updated replace state with the snapshot", () => {
    expect(applySessionEvent(null, { type: "session.started", session })).toBe(session);
    expect(applySessionEvent(null, { type: "session.updated", session })).toBe(session);
  });
  it("ended clears state", () => {
    expect(applySessionEvent(session, { type: "session.ended" })).toBeNull();
  });
  it("ignores unrelated events", () => {
    expect(applySessionEvent(session, { type: "review.updated", state: "OPEN" })).toBe(session);
  });
});

describe("predicates", () => {
  it("isLeader", () => {
    expect(isLeader(session, "lead")).toBe(true);
    expect(isLeader(session, "u2")).toBe(false);
    expect(isLeader(null, "lead")).toBe(false);
  });
  it("isInSession", () => {
    expect(isInSession(session, "u2")).toBe(true);
    expect(isInSession(session, "stranger")).toBe(false);
    expect(isInSession(null, "u2")).toBe(false);
  });
  it("canStart only when no session", () => {
    expect(canStart(null)).toBe(true);
    expect(canStart(session)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `CI=true npx vitest run tests/unit/session-client.test.ts`
Expected: FAIL — `@/lib/session-client` not found.

- [ ] **Step 3: Implement `lib/session-client.ts`**

```ts
import type { DocEvent, ReviewSession } from "@/lib/events";

/** Pure reduction of a session event into the next session state, keyed by document. */
export function applySessionEvent(session: ReviewSession | null, event: DocEvent): ReviewSession | null {
  switch (event.type) {
    case "session.started":
    case "session.updated":
      return event.session;
    case "session.ended":
      return null;
    default:
      return session;
  }
}

export function isLeader(session: ReviewSession | null, userId: string): boolean {
  return session?.leaderId === userId;
}

export function isInSession(session: ReviewSession | null, userId: string): boolean {
  return !!session?.participants.some((p) => p.userId === userId);
}

export function canStart(session: ReviewSession | null): boolean {
  return session === null;
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `CI=true npx vitest run tests/unit/session-client.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
rtk git add lib/session-client.ts tests/unit/session-client.test.ts
rtk git commit -m "feat(m5-p4): pure client session reducer and predicates"
```

---

## Task 6: SessionBanner component & DocumentView wiring

**Goal:** Render the session UI in the document header and wire `DocumentView` to track session state from the SSE stream and POST lifecycle actions — no new `EventSource`.

**Files:**
- Create: `components/SessionBanner.tsx`
- Modify: `components/DocumentView.tsx` (imports `:8-12`; state ~`:89-91`; the SSE switch `:402-404`; the header row `:519-524`)

**Acceptance Criteria:**
- [ ] No active session → a `start-session` button is shown.
- [ ] Active session, viewer not joined → `session-banner` with `session-leader-name`, `session-participant-count`, and a `join-session` button.
- [ ] Active session, joined non-leader → `session-banner` with a `leave-session` button.
- [ ] Active session, viewer is leader → `session-banner` with an `end-session` button.
- [ ] Buttons POST `{ action }` to `/api/documents/[id]/session` and disable while in flight.
- [ ] `DocumentView`'s SSE switch updates session state on `session.started`/`session.updated`/`session.ended`.
- [ ] `npx tsc --noEmit` and `CI=true pnpm lint` are clean.

**Verify:** `npx tsc --noEmit` → clean; `CI=true pnpm lint` → clean. (Behavior is covered by the Task 7 e2e.)

**Steps:**

- [ ] **Step 1: Implement `components/SessionBanner.tsx`**

```tsx
"use client";
import { Button } from "@/components/ui/Button";
import type { ReviewSession } from "@/lib/events";
import { isLeader, isInSession, canStart } from "@/lib/session-client";
import type { SessionAction } from "@/lib/enums";

export default function SessionBanner({
  session,
  currentUserId,
  onAction,
  pending,
}: {
  session: ReviewSession | null;
  currentUserId: string;
  onAction: (action: SessionAction) => void;
  pending: boolean;
}) {
  if (canStart(session)) {
    return (
      <Button
        variant="secondary"
        size="sm"
        data-testid="start-session"
        disabled={pending}
        onClick={() => onAction("start")}
      >
        Start session
      </Button>
    );
  }

  const s = session!;
  const leader = isLeader(s, currentUserId);
  const joined = isInSession(s, currentUserId);
  const count = s.participants.length;

  return (
    <div
      data-testid="session-banner"
      className="flex items-center gap-2 rounded-[var(--radius-app)] border border-border bg-surface px-3 py-1 text-sm"
    >
      {leader ? (
        <span>
          You&apos;re leading · <span data-testid="session-participant-count">{count}</span> participant
          {count === 1 ? "" : "s"}
        </span>
      ) : (
        <span>
          <span data-testid="session-leader-name">{s.leaderName}</span> is leading a review session ·{" "}
          <span data-testid="session-participant-count">{count}</span> in session
        </span>
      )}
      {leader ? (
        <Button variant="danger" size="sm" data-testid="end-session" disabled={pending} onClick={() => onAction("end")}>
          End session
        </Button>
      ) : joined ? (
        <Button variant="secondary" size="sm" data-testid="leave-session" disabled={pending} onClick={() => onAction("leave")}>
          Leave
        </Button>
      ) : (
        <Button variant="secondary" size="sm" data-testid="join-session" disabled={pending} onClick={() => onAction("join")}>
          Join
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire `DocumentView.tsx` — imports**

After the existing presence imports (~`:9-12`), add:

```tsx
import { applySessionEvent } from "@/lib/session-client";
import SessionBanner from "@/components/SessionBanner";
import type { ReviewSession } from "@/lib/events";
import type { SessionAction } from "@/lib/enums";
```

(`ReviewSession` may be merged into the existing `@/lib/events` type import line — keep one import from that module.)

- [ ] **Step 3: Add session state and the action poster**

After the `roster` state (`:89-91`), add:

```tsx
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [sessionPending, setSessionPending] = useState(false);

  const postSessionAction = useCallback(
    (action: SessionAction) => {
      setSessionPending(true);
      fetch(`/api/documents/${doc.id}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
        .catch(() => {})
        .finally(() => setSessionPending(false));
    },
    [doc.id],
  );
```

- [ ] **Step 4: Extend the SSE switch**

In the `es.onmessage` handler, after the `presence.*` branch (`:402-404`), add:

```tsx
        } else if (e.type === "session.started" || e.type === "session.updated" || e.type === "session.ended") {
          setSession((prev) => applySessionEvent(prev, e));
```

- [ ] **Step 5: Render the banner in the header**

In the header row (after `<PresenceRoster ... />`, `:521`), add:

```tsx
          <SessionBanner
            session={session}
            currentUserId={currentUserId}
            onAction={postSessionAction}
            pending={sessionPending}
          />
```

- [ ] **Step 6: Verify typecheck and lint**

Run: `npx tsc --noEmit` → clean
Run: `CI=true pnpm lint` → clean

- [ ] **Step 7: Commit**

```bash
rtk git add components/SessionBanner.tsx components/DocumentView.tsx
rtk git commit -m "feat(m5-p4): SessionBanner UI and DocumentView session wiring"
```

---

## Task 7: End-to-end session lifecycle test & full verification

**Goal:** Prove the full lifecycle across two browser contexts and confirm the no-third-EventSource invariant, then run the complete verification suite.

**Files:**
- Create: `tests/e2e/sessions.spec.ts`

**Acceptance Criteria:**
- [ ] A starts a session → both A and B see it (A as leader, B with a Join button).
- [ ] B joins → both banners show 2 participants.
- [ ] A ends the session → both banners clear.
- [ ] A's tab holds exactly 2 EventSource connections throughout.
- [ ] Leader-drop: closing A's context clears B's banner within the TTL window.
- [ ] `CI=true pnpm test:unit`, `CI=true pnpm test:e2e`, and `CI=true pnpm lint` all pass.

**Verify:** `CI=true pnpm test:e2e -- sessions` → PASS; then full `CI=true pnpm test:unit && CI=true pnpm test:e2e && CI=true pnpm lint` → all PASS.

**Steps:**

- [ ] **Step 1: Free port 3000 (per M-notes)**

```bash
lsof -ti:3000 | xargs -r kill -9 2>/dev/null; true
```

- [ ] **Step 2: Write `tests/e2e/sessions.spec.ts`**

```ts
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function countEventSources(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __esCount: number; EventSource: typeof EventSource };
    w.__esCount = 0;
    const Native = w.EventSource;
    class Counting extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        w.__esCount += 1;
      }
    }
    w.EventSource = Counting as unknown as typeof EventSource;
  });
}

test("review session lifecycle across two participants", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await countEventSources(ctxA);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  await pageA.goto("/app");
  await pageA.getByLabel("title").fill("Session demo");
  await pageA.getByLabel("markdown").fill("# Hello\n\nReview me together.");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\/[^/]+$/);
  const docUrl = pageA.url();

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();

  // A starts a session.
  await pageA.getByTestId("start-session").click();
  await expect(pageA.getByTestId("session-banner")).toContainText("You're leading");
  await expect(pageB.getByTestId("session-banner")).toContainText("Ada");
  await expect(pageB.getByTestId("join-session")).toBeVisible();

  // B joins → both show 2 participants.
  await pageB.getByTestId("join-session").click();
  await expect(pageA.getByTestId("session-participant-count")).toHaveText("2");
  await expect(pageB.getByTestId("session-participant-count")).toHaveText("2");
  await expect(pageB.getByTestId("leave-session")).toBeVisible();

  // Exactly two EventSources in A's tab (document + notifications).
  const esCount = await pageA.evaluate(() => (window as unknown as { __esCount: number }).__esCount);
  expect(esCount).toBe(2);

  // A ends the session → both banners clear.
  await pageA.getByTestId("end-session").click();
  await expect(pageA.getByTestId("session-banner")).toHaveCount(0);
  await expect(pageB.getByTestId("session-banner")).toHaveCount(0);
  await expect(pageA.getByTestId("start-session")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test("session auto-ends when the leader disconnects", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  await pageA.goto("/app");
  await pageA.getByLabel("title").fill("Leader drop");
  await pageA.getByLabel("markdown").fill("# Drop test");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\/[^/]+$/);
  const docUrl = pageA.url();

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await pageA.getByTestId("start-session").click();
  await pageB.getByTestId("join-session").click();
  await expect(pageB.getByTestId("session-banner")).toBeVisible();

  // Leader's tab closes → B's banner clears within the presence-TTL + sweep window.
  await ctxA.close();
  await expect(pageB.getByTestId("session-banner")).toHaveCount(0, { timeout: 30_000 });

  await ctxB.close();
});
```

- [ ] **Step 3: Run the new e2e spec**

Run: `CI=true pnpm test:e2e -- sessions`
Expected: PASS (both tests).

> If the auto-end test is slow/flaky against the default TTL, set `PRESENCE_TTL_MS=3000 SESSION_SWEEP_MS=2000` for the e2e run (the Playwright server reads env); the 30s timeout already accommodates defaults.

- [ ] **Step 4: Full verification suite**

```bash
lsof -ti:3000 | xargs -r kill -9 2>/dev/null; true
CI=true pnpm test:unit
CI=true pnpm test:e2e
CI=true pnpm lint
```

Expected: all PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
rtk git add tests/e2e/sessions.spec.ts
rtk git commit -m "test(m5-p4): e2e session lifecycle and leader-drop auto-end"
```

---

## Self-Review

- **Spec coverage:** data model (T1) · registry+lifecycle+sweep (T2) · route incl. 401/404/400/409/403 (T3) · connect snapshot (T4) · client reducer+predicates (T5) · SessionBanner four states + DocumentView wiring + no-third-EventSource (T6) · e2e + leader-drop + full verification (T7). All design sections map to a task.
- **Type consistency:** `ReviewSession`/`SessionParticipant` defined in `lib/events.ts` (T1) and imported everywhere; `SessionAction`/`SESSION_ACTIONS` from `lib/enums.ts`; fn names `startSession`/`joinSession`/`leaveSession`/`endSession`/`getSession`/`evictStaleSessions` consistent across T2/T3/T4 and tests; event names `session.started`/`session.updated`/`session.ended` consistent across T1/T4/T5/T6.
- **No placeholders:** every code step contains complete code; every verify step has a concrete command.

## Post-completion

After Task 7 passes, finish the phase per the standard flow: mark all `.tasks.json` tasks complete, then open a PR (the worktree branch). Per project memory, phases ultimately land on local `main` by fast-forward, not by merging the PR — confirm with the user before integrating.
