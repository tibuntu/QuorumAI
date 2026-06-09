# M5 P1 — Presence Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, live, who else is viewing a document — an avatar stack in the document header that updates as reviewers open and close the page.

**Architecture:** An in-memory presence registry (`lib/presence.ts`, `globalThis`-stashed like `lib/events.ts`) holds `Map<docId, Map<userId, PresenceEntry>>` and runs a TTL sweep. Clients send a throttled `POST` heartbeat; presence changes fan out over the **existing** document SSE stream as new `DocEvent`s (`presence.sync`/`presence.updated`/`presence.left`). No new `EventSource`, no DB, no new dependencies — single Next process, single instance.

**Tech Stack:** Next 16 (App Router, standalone server), React 19, TypeScript, `node:events` bus, Vitest (unit), Playwright (e2e), Tailwind v4.

**Design spec:** `docs/superpowers/specs/2026-06-09-quorum-ai-m5-p1-presence-roster-design.md`

**Conventions carried from M1–M4:** pure libs → services → thin routes → client; run scripts with `CI=true`; free port 3000 before `pnpm test:e2e`; preserve existing `data-testid`/`aria-label` hooks; this repo's pnpm is v11.5.2.

---

### Task 1: Extend the `DocEvent` union with presence events

**Goal:** Add the `PresenceEntry` type and three presence event variants to the event bus so registry, routes, and client all share one source of truth.

**Files:**
- Modify: `lib/events.ts`
- Test: `tests/unit/events.presence.test.ts` (create)

**Acceptance Criteria:**
- [ ] `PresenceEntry { userId: string; name: string; lastSeen: number }` is exported from `lib/events.ts`.
- [ ] `DocEvent` union includes `presence.sync` (carries `roster: PresenceEntry[]`), `presence.updated` (carries `entry: PresenceEntry`), and `presence.left` (carries `userId: string`).
- [ ] `publish`/`subscribe` are unchanged and deliver a presence event to a subscriber of the same document.

**Verify:** `CI=true pnpm test:unit tests/unit/events.presence.test.ts` → PASS

**Why `PresenceEntry` lives in `events.ts`:** `lib/presence.ts` imports `publish` from `lib/events.ts`. Defining `PresenceEntry` in `events.ts` keeps the dependency one-way (`presence → events`) and lets client components import the type without importing the server-only registry.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/events.presence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { publish, subscribe, type DocEvent, type PresenceEntry } from "@/lib/events";

describe("presence events on the bus", () => {
  it("delivers presence.updated to subscribers of the same document", () => {
    const got: DocEvent[] = [];
    const unsub = subscribe("doc-presence-1", (e) => got.push(e));
    const entry: PresenceEntry = { userId: "u1", name: "Ada", lastSeen: 1000 };
    publish("doc-presence-1", { type: "presence.updated", entry });
    publish("doc-presence-2", { type: "presence.left", userId: "u9" });
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual({ type: "presence.updated", entry });
    unsub();
  });

  it("carries a full roster on presence.sync", () => {
    const got: DocEvent[] = [];
    const unsub = subscribe("doc-presence-3", (e) => got.push(e));
    const roster: PresenceEntry[] = [{ userId: "u1", name: "Ada", lastSeen: 1 }];
    publish("doc-presence-3", { type: "presence.sync", roster });
    expect(got[0]).toEqual({ type: "presence.sync", roster });
    unsub();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm test:unit tests/unit/events.presence.test.ts`
Expected: FAIL — `PresenceEntry` not exported / union members unknown (type errors or assertion failure).

- [ ] **Step 3: Add the type and union members**

In `lib/events.ts`, after the `ClientNotification` interface (around line 11), add:

```ts
export interface PresenceEntry {
  userId: string;
  name: string;
  lastSeen: number; // epoch ms
}
```

Then extend the `DocEvent` union (the existing block at lines 13-21) by appending these three members before the closing `;`:

```ts
  | { type: "presence.sync"; roster: PresenceEntry[] }
  | { type: "presence.updated"; entry: PresenceEntry }
  | { type: "presence.left"; userId: string };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm test:unit tests/unit/events.presence.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add lib/events.ts tests/unit/events.presence.test.ts
git commit -m "feat(m5-p1): add presence events to DocEvent union"
```

---

### Task 2: Presence registry + TTL sweep (`lib/presence.ts`)

**Goal:** A `globalThis`-stashed in-memory registry with `heartbeat`/`leave`/`roster` plus an env-tunable TTL eviction that publishes `presence.left` for stale entries.

**Files:**
- Create: `lib/presence.ts`
- Test: `tests/unit/presence.test.ts` (create)

**Acceptance Criteria:**
- [ ] `heartbeat(docId, { userId, name })` upserts the entry, bumps `lastSeen`, and publishes `presence.updated`.
- [ ] `roster(docId)` returns current entries; a second heartbeat for the same `userId` keeps the roster at one entry (dedupe).
- [ ] `leave(docId, userId)` removes the entry and publishes `presence.left`; a `leave` for an absent user is a no-op (no event).
- [ ] `evictStale()` removes entries older than `PRESENCE_TTL_MS` and publishes `presence.left` for each; fresh entries survive.
- [ ] A single `globalThis`-guarded `setInterval` runs `evictStale` every `PRESENCE_SWEEP_MS` and is `unref`'d so it never keeps the process alive.

**Verify:** `CI=true pnpm test:unit tests/unit/presence.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/presence.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { subscribe, type DocEvent } from "@/lib/events";
import { heartbeat, leave, roster, evictStale } from "@/lib/presence";

function capture(docId: string): { events: DocEvent[]; stop: () => void } {
  const events: DocEvent[] = [];
  const stop = subscribe(docId, (e) => events.push(e));
  return { events, stop };
}

describe("presence registry", () => {
  beforeEach(() => {
    // isolate each test on its own doc id; registry is module-global
  });

  it("heartbeat adds an entry and publishes presence.updated", () => {
    const { events, stop } = capture("p-doc-1");
    heartbeat("p-doc-1", { userId: "u1", name: "Ada" });
    expect(roster("p-doc-1").map((e) => e.userId)).toEqual(["u1"]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "presence.updated" })
    );
    stop();
  });

  it("dedupes repeated heartbeats by userId and bumps lastSeen", () => {
    heartbeat("p-doc-2", { userId: "u1", name: "Ada" });
    const first = roster("p-doc-2")[0].lastSeen;
    heartbeat("p-doc-2", { userId: "u1", name: "Ada Lovelace" });
    const after = roster("p-doc-2");
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("Ada Lovelace");
    expect(after[0].lastSeen).toBeGreaterThanOrEqual(first);
  });

  it("leave removes the entry and publishes presence.left; absent leave is a no-op", () => {
    heartbeat("p-doc-3", { userId: "u1", name: "Ada" });
    const { events, stop } = capture("p-doc-3");
    leave("p-doc-3", "u1");
    expect(roster("p-doc-3")).toHaveLength(0);
    expect(events).toContainEqual({ type: "presence.left", userId: "u1" });
    leave("p-doc-3", "u-absent"); // no throw, no event
    expect(events.filter((e) => e.type === "presence.left")).toHaveLength(1);
    stop();
  });

  it("evictStale removes entries older than PRESENCE_TTL_MS", async () => {
    process.env.PRESENCE_TTL_MS = "5";
    heartbeat("p-doc-4", { userId: "u1", name: "Ada" });
    const { events, stop } = capture("p-doc-4");
    await new Promise((r) => setTimeout(r, 15));
    evictStale();
    expect(roster("p-doc-4")).toHaveLength(0);
    expect(events).toContainEqual({ type: "presence.left", userId: "u1" });
    stop();
    delete process.env.PRESENCE_TTL_MS;
  });

  it("evictStale keeps fresh entries", () => {
    process.env.PRESENCE_TTL_MS = "10000";
    heartbeat("p-doc-5", { userId: "u1", name: "Ada" });
    evictStale();
    expect(roster("p-doc-5")).toHaveLength(1);
    delete process.env.PRESENCE_TTL_MS;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm test:unit tests/unit/presence.test.ts`
Expected: FAIL — `Cannot find module '@/lib/presence'`.

- [ ] **Step 3: Implement `lib/presence.ts`**

Create `lib/presence.ts`:

```ts
import { publish, type PresenceEntry } from "@/lib/events";

export type { PresenceEntry };

type Registry = Map<string, Map<string, PresenceEntry>>;

const globalForPresence = globalThis as unknown as {
  presenceRegistry?: Registry;
  presenceSweep?: ReturnType<typeof setInterval>;
};

const registry: Registry = globalForPresence.presenceRegistry ?? new Map();
if (process.env.NODE_ENV !== "production") globalForPresence.presenceRegistry = registry;

/** Upsert the user's presence in a document, bump lastSeen, and broadcast. */
export function heartbeat(documentId: string, user: { userId: string; name: string }): void {
  let docMap = registry.get(documentId);
  if (!docMap) {
    docMap = new Map();
    registry.set(documentId, docMap);
  }
  const entry: PresenceEntry = { userId: user.userId, name: user.name, lastSeen: Date.now() };
  docMap.set(user.userId, entry);
  publish(documentId, { type: "presence.updated", entry });
}

/** Remove a user from a document's roster and broadcast. No-op if absent. */
export function leave(documentId: string, userId: string): void {
  const docMap = registry.get(documentId);
  if (!docMap || !docMap.has(userId)) return;
  docMap.delete(userId);
  if (docMap.size === 0) registry.delete(documentId);
  publish(documentId, { type: "presence.left", userId });
}

/** Current presence entries for a document (empty array when none). */
export function roster(documentId: string): PresenceEntry[] {
  return Array.from(registry.get(documentId)?.values() ?? []);
}

/** Evict entries older than PRESENCE_TTL_MS, broadcasting presence.left for each. */
export function evictStale(): void {
  const ttl = Number(process.env.PRESENCE_TTL_MS ?? 15_000);
  const cutoff = Date.now() - ttl;
  for (const [documentId, docMap] of registry) {
    for (const [userId, entry] of docMap) {
      if (entry.lastSeen < cutoff) {
        docMap.delete(userId);
        publish(documentId, { type: "presence.left", userId });
      }
    }
    if (docMap.size === 0) registry.delete(documentId);
  }
}

// One process-wide sweep, guarded so dev hot-reload doesn't spawn duplicates.
if (!globalForPresence.presenceSweep) {
  const sweepMs = Number(process.env.PRESENCE_SWEEP_MS ?? 10_000);
  const timer = setInterval(evictStale, sweepMs);
  timer.unref?.(); // never keep the process (or a test runner) alive for the sweep
  globalForPresence.presenceSweep = timer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm test:unit tests/unit/presence.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add lib/presence.ts tests/unit/presence.test.ts
git commit -m "feat(m5-p1): in-memory presence registry with TTL sweep"
```

---

### Task 3: Heartbeat POST route

**Goal:** A throttled beacon endpoint that records presence (or departure) for the authenticated participant.

**Files:**
- Create: `app/api/documents/[id]/presence/route.ts`
- Test: `tests/unit/presence.route.test.ts` (create)

**Acceptance Criteria:**
- [ ] `POST` with no/empty body → `presence.heartbeat(id, { userId, name })` using the session user; returns `204`.
- [ ] `POST` with `{ leaving: true }` → `presence.leave(id, userId)`; returns `204`.
- [ ] Unauthenticated → `401`; authenticated non-participant → `404` (mirrors the annotations route).
- [ ] User name falls back to email, then `"Someone"`, when `name` is blank.

**Verify:** `CI=true pnpm test:unit tests/unit/presence.route.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/presence.route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/authz", () => ({ isParticipant: vi.fn() }));
vi.mock("@/lib/presence", () => ({ heartbeat: vi.fn(), leave: vi.fn() }));

import { POST } from "@/app/api/documents/[id]/presence/route";
import * as api from "@/lib/api";
import * as authz from "@/lib/authz";
import * as presence from "@/lib/presence";

function req(body?: unknown): Request {
  return new Request("http://test/api/documents/doc1/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: "doc1" }) };

describe("POST /api/documents/[id]/presence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(401);
  });

  it("404 when not a participant", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(false);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
  });

  it("heartbeats and returns 204 for a participant", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" });
    expect(presence.leave).not.toHaveBeenCalled();
  });

  it("leaves when body says leaving:true", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ leaving: true }), ctx);
    expect(res.status).toBe(204);
    expect(presence.leave).toHaveBeenCalledWith("doc1", "u1");
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });

  it("falls back to email then 'Someone' for a blank name", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "", email: "a@b.co" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    await POST(req(), ctx);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "a@b.co" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm test:unit tests/unit/presence.route.test.ts`
Expected: FAIL — route module does not exist.

- [ ] **Step 3: Implement the route**

Create `app/api/documents/[id]/presence/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { isParticipant } from "@/lib/authz";
import { heartbeat, leave } from "@/lib/presence";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (body?.leaving === true) {
    leave(id, user.id);
  } else {
    const name = (user.name && user.name.trim()) || user.email || "Someone";
    heartbeat(id, { userId: user.id, name });
  }
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm test:unit tests/unit/presence.route.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add "app/api/documents/[id]/presence/route.ts" tests/unit/presence.route.test.ts
git commit -m "feat(m5-p1): presence heartbeat POST route"
```

---

### Task 4: Emit `presence.sync` snapshot on SSE connect

**Goal:** When a client connects to the document stream, immediately send the current roster so it renders without waiting for the next heartbeat.

**Files:**
- Modify: `app/api/documents/[id]/stream/route.ts`
- Test: `tests/unit/stream.presence-sync.test.ts` (create)

**Acceptance Criteria:**
- [ ] On connect, after `: connected`, the stream emits one `data:` line whose JSON is `{ type: "presence.sync", roster: [...] }` built from `roster(id)`.
- [ ] No third `EventSource` is introduced — presence rides this existing stream.
- [ ] Existing behavior (401/404 gating, subsequent event forwarding, heartbeat comment) is unchanged.

**Verify:** `CI=true pnpm test:unit tests/unit/stream.presence-sync.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/stream.presence-sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/authz", () => ({ isParticipant: vi.fn() }));

import { GET } from "@/app/api/documents/[id]/stream/route";
import * as api from "@/lib/api";
import * as authz from "@/lib/authz";
import { heartbeat } from "@/lib/presence";

const ctx = { params: Promise.resolve({ id: "stream-doc-1" }) };

describe("GET /api/documents/[id]/stream presence.sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a presence.sync snapshot of the current roster on connect", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "viewer" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    heartbeat("stream-doc-1", { userId: "u1", name: "Ada" });

    const res = await GET(new Request("http://test"), ctx);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    // Drain a couple of chunks; the snapshot is enqueued right after ": connected".
    let buf = dec.decode((await reader.read()).value);
    buf += dec.decode((await reader.read()).value ?? new Uint8Array());
    expect(buf).toContain("presence.sync");
    expect(buf).toContain('"userId":"u1"');
    await reader.cancel();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm test:unit tests/unit/stream.presence-sync.test.ts`
Expected: FAIL — stream sends `: connected` but no `presence.sync`.

- [ ] **Step 3: Modify the stream route**

In `app/api/documents/[id]/stream/route.ts`, add the import at the top:

```ts
import { roster } from "@/lib/presence";
```

Then inside `start(controller)`, immediately after the existing `controller.enqueue(encoder.encode(`: connected\n\n`));` line, add:

```ts
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "presence.sync", roster: roster(id) })}\n\n`)
      );
```

(Leave the `send`, `subscribe`, and `heartbeat` lines as they are.)

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm test:unit tests/unit/stream.presence-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/documents/[id]/stream/route.ts" tests/unit/stream.presence-sync.test.ts
git commit -m "feat(m5-p1): stream current roster as presence.sync on connect"
```

---

### Task 5: `PresenceRoster` avatar-stack component

**Goal:** A presentational component that renders the roster as an overlapping initial-avatar stack with a `+N` overflow and a hover/tooltip name list, marking the current user `(you)`. The presentation logic lives in pure helpers (unit-tested); rendering is covered by the Task 7 E2E.

**Files:**
- Create: `lib/presence-roster.ts` (pure helpers)
- Create: `components/PresenceRoster.tsx`
- Test: `tests/unit/presence-roster.test.ts` (create)

**Acceptance Criteria:**
- [ ] `initials(name)` yields 1–2 uppercase letters (first+last initial, or first two letters of a single token, `"?"` when blank).
- [ ] `colorFor(userId)` is deterministic and always returns a class from the palette.
- [ ] `viewingLabel(count)` is `"1 person viewing"` for 1, `"N people viewing"` otherwise.
- [ ] `orderRoster(roster, currentUserId)` puts the current user first, then others ordered stably by `userId`.
- [ ] `displayName(entry, currentUserId)` appends `" (you)"` only for the current user.
- [ ] The component returns `null` for an empty roster, caps visible avatars at `MAX_VISIBLE_AVATARS` (4) with a `+N` chip, sets `data-testid="presence-roster"` + `aria-label`, and gives each avatar `data-testid="presence-avatar"` + `data-user-name`.

**Verify:** `CI=true pnpm test:unit tests/unit/presence-roster.test.ts && CI=true pnpm lint` → PASS

**Why pure helpers instead of a rendered-component test:** the repo has no component-rendering unit tests — every `tests/unit/*` is plain `.ts` over pure logic, and DOM behavior is covered by Playwright. Extracting the presentation logic into `lib/presence-roster.ts` keeps that convention, adds zero test dependencies (no jsdom/RTL), and the Task 7 E2E asserts the rendered output.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/presence-roster.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  initials,
  colorFor,
  viewingLabel,
  orderRoster,
  displayName,
  AVATAR_COLORS,
} from "@/lib/presence-roster";
import type { PresenceEntry } from "@/lib/events";

const entry = (userId: string, name: string): PresenceEntry => ({ userId, name, lastSeen: 0 });

describe("presence-roster helpers", () => {
  it("initials: first+last initial, single-token fallback, blank guard", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Grace")).toBe("GR");
    expect(initials("  ")).toBe("?");
    expect(initials("Ada Byron Lovelace")).toBe("AL");
  });

  it("colorFor: deterministic and within the palette", () => {
    expect(colorFor("user-1")).toBe(colorFor("user-1"));
    expect(AVATAR_COLORS).toContain(colorFor("user-1"));
    expect(AVATAR_COLORS).toContain(colorFor("xyz"));
  });

  it("viewingLabel: singular vs plural", () => {
    expect(viewingLabel(1)).toBe("1 person viewing");
    expect(viewingLabel(3)).toBe("3 people viewing");
  });

  it("orderRoster: self first, others stable by userId", () => {
    const ordered = orderRoster([entry("u2", "Grace"), entry("me", "Ada"), entry("u1", "Alan")], "me");
    expect(ordered.map((e) => e.userId)).toEqual(["me", "u1", "u2"]);
  });

  it("displayName: marks only the current user", () => {
    expect(displayName(entry("me", "Ada"), "me")).toBe("Ada (you)");
    expect(displayName(entry("u2", "Grace"), "me")).toBe("Grace");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm test:unit tests/unit/presence-roster.test.ts`
Expected: FAIL — `@/lib/presence-roster` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `lib/presence-roster.ts`:

```ts
import type { PresenceEntry } from "@/lib/events";

export const AVATAR_COLORS = [
  "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500",
  "bg-teal-500", "bg-sky-500", "bg-indigo-500", "bg-violet-500", "bg-fuchsia-500",
] as const;

export const MAX_VISIBLE_AVATARS = 4;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function colorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function viewingLabel(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"} viewing`;
}

export function displayName(entry: PresenceEntry, currentUserId: string): string {
  return entry.userId === currentUserId ? `${entry.name} (you)` : entry.name;
}

/** Current user first, then others ordered stably by userId. Does not mutate the input. */
export function orderRoster(roster: PresenceEntry[], currentUserId: string): PresenceEntry[] {
  return [...roster].sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return a.userId < b.userId ? -1 : 1;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm test:unit tests/unit/presence-roster.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Implement the component**

Create `components/PresenceRoster.tsx`:

```tsx
"use client";
import type { PresenceEntry } from "@/lib/events";
import {
  colorFor,
  displayName,
  initials,
  MAX_VISIBLE_AVATARS,
  orderRoster,
  viewingLabel,
} from "@/lib/presence-roster";

export default function PresenceRoster({
  roster,
  currentUserId,
}: {
  roster: PresenceEntry[];
  currentUserId: string;
}) {
  if (roster.length === 0) return null;

  const sorted = orderRoster(roster, currentUserId);
  const visible = sorted.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = sorted.length - visible.length;
  const allNames = sorted.map((e) => displayName(e, currentUserId)).join(", ");

  return (
    <div
      data-testid="presence-roster"
      aria-label={viewingLabel(roster.length)}
      title={allNames}
      className="flex items-center"
    >
      <div className="flex -space-x-2">
        {visible.map((e) => {
          const name = displayName(e, currentUserId);
          return (
            <span
              key={e.userId}
              data-testid="presence-avatar"
              data-user-name={name}
              title={name}
              className={`${colorFor(e.userId)} flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-surface`}
            >
              {initials(e.name)}
            </span>
          );
        })}
        {overflow > 0 && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground ring-2 ring-surface">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify lint**

Run: `CI=true pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/presence-roster.ts components/PresenceRoster.tsx tests/unit/presence-roster.test.ts
git commit -m "feat(m5-p1): PresenceRoster avatar-stack component"
```

---

### Task 6: Presence reducer + wire `DocumentView` and the document page

**Goal:** Add a pure client reducer for presence events, seed the current user optimistically, send heartbeats, render `PresenceRoster` in the header, and pass the current user's identity from the server page.

**Files:**
- Create: `lib/presence-client.ts`
- Test: `tests/unit/presence-client.test.ts` (create)
- Modify: `components/DocumentView.tsx`
- Modify: `app/app/documents/[id]/page.tsx`

**Acceptance Criteria:**
- [ ] `applyPresenceEvent(roster, event, self)` is a pure function: `presence.sync` replaces the roster (re-adding `self` if the snapshot omits it), `presence.updated` upserts by `userId`, `presence.left` removes by `userId`, other events return the roster unchanged.
- [ ] `DocumentView` accepts `currentUserId` and `currentUserName` props, seeds roster state with the current user, and renders `<PresenceRoster>` in the header next to the title.
- [ ] The existing document `EventSource` `onmessage` switch handles the three presence events via `applyPresenceEvent` (no new `EventSource`).
- [ ] `DocumentView` POSTs a heartbeat on mount and every `NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS` (default 10000), and sends a `{ leaving: true }` `navigator.sendBeacon` on `pagehide` and on unmount.
- [ ] `app/app/documents/[id]/page.tsx` passes `currentUserId={session.user.id}` and `currentUserName` (name → email → `"You"`).

**Verify:** `CI=true pnpm test:unit tests/unit/presence-client.test.ts && CI=true pnpm lint` → PASS

**Steps:**

- [ ] **Step 1: Write the failing reducer test**

Create `tests/unit/presence-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyPresenceEvent } from "@/lib/presence-client";
import type { PresenceEntry } from "@/lib/events";

const self = { userId: "me", name: "Ada" };
const entry = (userId: string, name: string): PresenceEntry => ({ userId, name, lastSeen: 1 });

describe("applyPresenceEvent", () => {
  it("sync replaces the roster and re-adds self when missing", () => {
    const next = applyPresenceEvent([], { type: "presence.sync", roster: [entry("u2", "Grace")] }, self);
    expect(next.map((e) => e.userId).sort()).toEqual(["me", "u2"]);
  });

  it("sync keeps self exactly once when already present", () => {
    const next = applyPresenceEvent([], { type: "presence.sync", roster: [entry("me", "Ada")] }, self);
    expect(next.filter((e) => e.userId === "me")).toHaveLength(1);
  });

  it("updated upserts by userId", () => {
    const start = [entry("me", "Ada")];
    const next = applyPresenceEvent(start, { type: "presence.updated", entry: entry("u2", "Grace") }, self);
    expect(next.map((e) => e.userId).sort()).toEqual(["me", "u2"]);
    const again = applyPresenceEvent(next, { type: "presence.updated", entry: entry("u2", "Grace Hopper") }, self);
    expect(again.filter((e) => e.userId === "u2")).toHaveLength(1);
    expect(again.find((e) => e.userId === "u2")!.name).toBe("Grace Hopper");
  });

  it("left removes by userId", () => {
    const start = [entry("me", "Ada"), entry("u2", "Grace")];
    const next = applyPresenceEvent(start, { type: "presence.left", userId: "u2" }, self);
    expect(next.map((e) => e.userId)).toEqual(["me"]);
  });

  it("ignores unrelated events", () => {
    const start = [entry("me", "Ada")];
    const next = applyPresenceEvent(start, { type: "review.updated", state: "OPEN" }, self);
    expect(next).toBe(start);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm test:unit tests/unit/presence-client.test.ts`
Expected: FAIL — `@/lib/presence-client` does not exist.

- [ ] **Step 3: Implement the reducer**

Create `lib/presence-client.ts`:

```ts
import type { DocEvent, PresenceEntry } from "@/lib/events";

/** Pure reduction of a presence event into the next roster, keyed by userId. */
export function applyPresenceEvent(
  roster: PresenceEntry[],
  event: DocEvent,
  self: { userId: string; name: string },
): PresenceEntry[] {
  switch (event.type) {
    case "presence.sync": {
      const hasSelf = event.roster.some((p) => p.userId === self.userId);
      return hasSelf
        ? event.roster
        : [...event.roster, { userId: self.userId, name: self.name, lastSeen: Date.now() }];
    }
    case "presence.updated": {
      const others = roster.filter((p) => p.userId !== event.entry.userId);
      return [...others, event.entry];
    }
    case "presence.left":
      return roster.filter((p) => p.userId !== event.userId);
    default:
      return roster;
  }
}
```

- [ ] **Step 4: Run reducer test to verify it passes**

Run: `CI=true pnpm test:unit tests/unit/presence-client.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Wire `DocumentView.tsx`**

(a) Update imports near the top of `components/DocumentView.tsx`:

```tsx
import { applyPresenceEvent } from "@/lib/presence-client";
import PresenceRoster from "@/components/PresenceRoster";
import type { PresenceEntry } from "@/lib/events";
```

(b) Change the component signature (line 65) to accept identity props:

```tsx
export default function DocumentView({
  doc,
  isOwner,
  editEnabled,
  currentUserId,
  currentUserName,
}: {
  doc: ClientDocument;
  isOwner: boolean;
  editEnabled: boolean;
  currentUserId: string;
  currentUserName: string;
}) {
```

(c) Add roster state alongside the other `useState` declarations (e.g. after line 84):

```tsx
  const [roster, setRoster] = useState<PresenceEntry[]>(() => [
    { userId: currentUserId, name: currentUserName, lastSeen: Date.now() },
  ]);
```

(d) In the document `EventSource` `onmessage` switch (the `else if` chain at lines 257-273), add a presence branch. Insert before the final `}` of the chain:

```tsx
        } else if (e.type === "presence.sync" || e.type === "presence.updated" || e.type === "presence.left") {
          setRoster((prev) => applyPresenceEvent(prev, e, { userId: currentUserId, name: currentUserName }));
        }
```

Add `currentUserId` and `currentUserName` to that `useEffect`'s dependency array (currently `[doc.id, refetchDetail]`) → `[doc.id, refetchDetail, currentUserId, currentUserName]`.

(e) Add a dedicated heartbeat effect (place it after the EventSource `useEffect`, around line 283):

```tsx
  // Presence heartbeat: ride a throttled POST beacon (NOT a third EventSource).
  useEffect(() => {
    const url = `/api/documents/${doc.id}/presence`;
    const send = () => {
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        keepalive: true,
      }).catch(() => {});
    };
    const leave = () => {
      const blob = new Blob([JSON.stringify({ leaving: true })], { type: "application/json" });
      navigator.sendBeacon?.(url, blob);
    };
    send();
    const intervalMs = Number(process.env.NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS ?? 10_000);
    const timer = setInterval(send, intervalMs);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      leave(); // best-effort fast departure on unmount
    };
  }, [doc.id]);
```

(f) Render the roster in the header. In the title row (the `<div className="mb-4 flex items-center gap-3">` at line 363), add `<PresenceRoster>` immediately after the `<h1>`:

```tsx
          <h1 className="text-2xl font-semibold text-foreground">{doc.title}</h1>
          <PresenceRoster roster={roster} currentUserId={currentUserId} />
```

- [ ] **Step 6: Pass identity from the page**

In `app/app/documents/[id]/page.tsx`, change the final return to pass the new props:

```tsx
  const currentUserName = session.user.name?.trim() || session.user.email || "You";

  return (
    <DocumentView
      doc={serializable}
      isOwner={isOwner}
      editEnabled={editEnabled}
      currentUserId={session.user.id}
      currentUserName={currentUserName}
    />
  );
```

- [ ] **Step 7: Verify lint + the full unit suite**

Run: `CI=true pnpm lint && CI=true pnpm test:unit`
Expected: lint clean; all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/presence-client.ts tests/unit/presence-client.test.ts components/DocumentView.tsx "app/app/documents/[id]/page.tsx"
git commit -m "feat(m5-p1): wire presence heartbeat, reducer, and roster into DocumentView"
```

---

### Task 7: Two-context Playwright E2E

**Goal:** Prove the roster works end-to-end across two logged-in browsers and that the tab still holds only two `EventSource` connections.

**Files:**
- Create: `tests/e2e/presence.spec.ts`

**Acceptance Criteria:**
- [ ] Two separate browser contexts (User A creates a doc; User B opens its URL and is auto-added as a participant) each show **2** people in `[data-testid="presence-roster"]`, with both display names present.
- [ ] After User B's context closes, User A's roster drops to 1 within the TTL window.
- [ ] In a context viewing the document, exactly **2** `EventSource` instances have been constructed (document stream + notifications stream) — no third.

**Verify:** Free port 3000, then `CI=true PRESENCE_TTL_MS=3000 PRESENCE_SWEEP_MS=1000 pnpm test:e2e tests/e2e/presence.spec.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the E2E spec**

Create `tests/e2e/presence.spec.ts`:

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

// Instrument window.EventSource construction count BEFORE any app script runs.
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

test("presence roster shows both viewers and stays at two EventSources", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await countEventSources(ctxA);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // User A registers and creates a document.
  await register(pageA, "Ada");
  await pageA.goto("/app");
  await pageA.getByLabel("title").fill("Presence demo");
  await pageA.getByLabel("markdown").fill("# Hello\n\nReview me together.");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\/[^/]+$/);
  const docUrl = pageA.url();

  // User B registers and opens the same document (link-grant adds them as participant).
  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();

  // Both rosters show two people, including both names.
  for (const page of [pageA, pageB]) {
    const stack = page.getByTestId("presence-roster");
    await expect(stack).toHaveAttribute("aria-label", /2 people viewing/);
    await expect(stack).toContainText(""); // ensure present
    await expect(stack.locator('[data-user-name*="Ada"]')).toHaveCount(1);
    await expect(stack.locator('[data-user-name*="Grace"]')).toHaveCount(1);
  }

  // Exactly two EventSource connections in A's tab (document + notifications).
  const esCount = await pageA.evaluate(() => (window as unknown as { __esCount: number }).__esCount);
  expect(esCount).toBe(2);

  // User B leaves; A's roster drops to one within the TTL window.
  await ctxB.close();
  await expect(pageA.getByTestId("presence-roster")).toHaveAttribute("aria-label", /1 person viewing/, {
    timeout: 10_000,
  });

  await ctxA.close();
});
```

> **Selector notes:** the New-document form lives on `/app` with `aria-label="title"` / `aria-label="markdown"` and a `Create document` button (see `components/NewDocumentForm.tsx`); registration mirrors `tests/e2e/navigation.spec.ts`. The avatar `data-user-name` is `"Ada (you)"` in A's own tab and `"Ada"` in B's, so the `*=` substring match works in both.

- [ ] **Step 2: Free port 3000 and run the E2E**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
CI=true PRESENCE_TTL_MS=3000 PRESENCE_SWEEP_MS=1000 pnpm test:e2e tests/e2e/presence.spec.ts
```

Expected: PASS. (Short TTL/sweep make the "drops to 1" assertion fast. Playwright's `webServer` reuses an existing dev server when not in CI; for a deterministic run let it build+start, or ensure a server started with these env values is running.)

> If the eviction assertion is flaky because the reused dev server didn't pick up the short TTL, run against a fresh server: `lsof -ti:3000 | xargs kill -9; CI=true PRESENCE_TTL_MS=3000 PRESENCE_SWEEP_MS=1000 pnpm build && CI=true PRESENCE_TTL_MS=3000 PRESENCE_SWEEP_MS=1000 pnpm start -p 3000` in one shell, then `pnpm test:e2e tests/e2e/presence.spec.ts` in another.

- [ ] **Step 3: Full gate run**

```bash
CI=true pnpm test:unit && CI=true pnpm lint
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
CI=true pnpm test:e2e
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/presence.spec.ts
git commit -m "test(m5-p1): two-context presence roster e2e"
```

---

## Verification summary

| Gate | Command |
|---|---|
| Unit | `CI=true pnpm test:unit` |
| Lint | `CI=true pnpm lint` |
| E2E | `lsof -ti:3000 \| xargs kill -9; CI=true pnpm test:e2e` |

All three must pass before opening the PR. PR targets `main`; rebase onto `main` rather than merging `main` in.

## Out of scope (M5 P2–P5)

Shared selections, live cursors, session lifecycle (leader/sessionId), follow-the-leader scroll. `PresenceEntry` is intentionally minimal so later phases add optional fields without breaking P1.
