# M4 · P3 — Live Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make in-app notifications live — a global per-user SSE stream drives a tab-title unread count and opt-in native Web Notifications.

**Architecture:** Reuse the in-memory `lib/events.ts` bus with a per-user topic `user-<id>`. `lib/notifications.ts` publishes on create/read. A new `/api/notifications/stream` SSE route (mirroring the per-document stream) fans events to the browser. A client `NotificationProvider` mounted in the app layout owns the EventSource, an unread reducer (pure, tested), the tab title, and OS-notify firing (pure predicate, tested). A `User.desktopNotifications` pref + settings toggle gates OS notifications.

**Tech Stack:** Node `EventEmitter` bus, Next.js route handler `ReadableStream` SSE, `EventSource`, React context, Prisma migration, Vitest.

**Design spec:** `docs/superpowers/specs/2026-06-08-quorum-ai-m4-p3-live-notifications-design.md`

**Worktree/env notes:** isolated worktree off `main`; `CI=true` on script runs; `.env`+`data/`+`prisma migrate deploy` for the unit suite (and you'll add a migration in Task 4 — run `prisma migrate dev` then); free port 3000 before e2e; preserve `data-testid`/`aria-label` hooks; rebase onto `main`.

---

### Task 1: Add notification event variants to the event bus

**Goal:** `lib/events.ts` carries notification events and exports a `ClientNotification` type, with no change to the `publish`/`subscribe` API.

**Files:**
- Modify: `lib/events.ts`
- Test: `tests/unit/events.notifications.test.ts`

**Acceptance Criteria:**
- [ ] `publish("user-x", { type: "notification.created", notification })` is received by a `subscribe("user-x", fn)` handler.
- [ ] `notification.read` (with `id`) and `notification.read.all` variants exist and type-check.
- [ ] Existing per-document events still type-check and pass.

**Verify:** `CI=true pnpm exec vitest run tests/unit/events.notifications.test.ts` → PASS; `CI=true pnpm exec tsc --noEmit` clean.

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/events.notifications.test.ts
import { describe, expect, test } from "vitest";
import { publish, subscribe, type ClientNotification } from "@/lib/events";

describe("per-user notification events", () => {
  test("subscriber receives a notification.created event", () => {
    const received: unknown[] = [];
    const off = subscribe("user-abc", (e) => received.push(e));
    const notification: ClientNotification = {
      id: "n1", type: "comment", documentId: "d1", documentTitle: "Plan", actorId: "u2", read: false,
      createdAt: new Date().toISOString(),
    };
    publish("user-abc", { type: "notification.created", notification });
    off();
    expect(received).toEqual([{ type: "notification.created", notification }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `CI=true pnpm exec vitest run tests/unit/events.notifications.test.ts` → FAIL (`ClientNotification` not exported).

- [ ] **Step 3: Extend `lib/events.ts`.** Add the exported type and the union variants (keep the single `DocEvent` union; `publish`/`subscribe` already take an arbitrary channel string):

```ts
export interface ClientNotification {
  id: string;
  type: string;          // "comment" | "review" | "version" | "resolve" (see notifications.ts)
  documentId: string;
  documentTitle: string;
  actorId: string | null;
  read: boolean;
  createdAt: string;     // ISO
}
```

  Add to the `DocEvent` union:

```ts
  | { type: "notification.created"; notification: ClientNotification }
  | { type: "notification.read"; id: string }
  | { type: "notification.read.all" }
```

- [ ] **Step 4: Run to verify it passes.** Run: `CI=true pnpm exec vitest run tests/unit/events.notifications.test.ts` → PASS. Then `CI=true pnpm exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit.**

```bash
git add lib/events.ts tests/unit/events.notifications.test.ts
git commit -m "feat(m4-p3): add per-user notification event variants to the bus"
```

---

### Task 2: Publish notification events from `lib/notifications.ts`

**Goal:** Creating notifications and marking them read publishes the corresponding per-user events.

**Files:**
- Modify: `lib/notifications.ts` (`notifyParticipants`, `markRead`, `markAllRead`)
- Test: `tests/unit/notifications.publish.test.ts`

**Acceptance Criteria:**
- [ ] `notifyParticipants` publishes one `notification.created` per recipient to `user-<recipientId>` with the created row's client shape (id, type, documentId, documentTitle, actorId, read=false, createdAt).
- [ ] `markRead` publishes `notification.read` with the id to the owner's topic; `markAllRead` publishes `notification.read.all`.
- [ ] Existing notification tests stay green (in-app rows + email enqueue unchanged).

**Verify:** `CI=true pnpm exec vitest run tests/unit/notifications.publish.test.ts tests/unit/notifications*.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test** (subscribe a spy to each recipient topic):

```ts
// tests/unit/notifications.publish.test.ts
import { describe, expect, test, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createDocument } from "@/lib/documents";
import { notifyParticipants, markAllRead } from "@/lib/notifications";
import { subscribe } from "@/lib/events";

async function makeUser(email: string) { return prisma.user.create({ data: { email, name: email.split("@")[0] } }); }

describe("notification publishing", () => {
  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.documentParticipant.deleteMany();
    await prisma.document.deleteMany();
    await prisma.user.deleteMany();
  });

  test("notifyParticipants publishes notification.created to each recipient", async () => {
    const owner = await makeUser("owner@example.com");
    const reviewer = await makeUser("rev@example.com");
    const id = await createDocument(owner.id, "Plan", "# hi");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: reviewer.id } });

    const events: any[] = [];
    const off = subscribe(`user-${reviewer.id}`, (e) => events.push(e));
    await notifyParticipants(id, owner.id, "comment"); // actor=owner → reviewer is the recipient
    off();

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("notification.created");
    expect(events[0].notification).toMatchObject({ documentId: id, type: "comment", read: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `CI=true pnpm exec vitest run tests/unit/notifications.publish.test.ts` → FAIL (no event published).

- [ ] **Step 3: Implement publishing in `lib/notifications.ts`.** Import `publish` and `type ClientNotification` from `@/lib/events`. In `notifyParticipants`, after the recipient rows are created, get each created row (create individually, or `createMany` then `findMany` the just-created ids — simplest is to map recipients and `create` each, capturing the row + needing the document title). Build and publish the client shape:

```ts
import { publish, type ClientNotification } from "@/lib/events";

// inside notifyParticipants, after determining `recipients` (participant userIds != actorId)
// and having the document title available (select it: prisma.document.findUnique({where:{id:documentId}, select:{title:true}})):
for (const userId of recipients) {
  const row = await prisma.notification.create({
    data: { userId, documentId, type, actorId },
  });
  const payload: ClientNotification = {
    id: row.id, type: row.type, documentId, documentTitle: title,
    actorId: row.actorId, read: row.read, createdAt: row.createdAt.toISOString(),
  };
  publish(`user-${userId}`, { type: "notification.created", notification: payload });
}
```

  Preserve the existing email-enqueue branch (EMAILABLE types) — restructure minimally; do not drop it. If the current code uses `createMany`, switch to per-recipient `create` (needed to get ids/createdAt for the payload) but keep behavior identical otherwise.

  In `markRead(userId, id)`: after the update, `publish(`user-${userId}`, { type: "notification.read", id });`
  In `markAllRead(userId)`: after the update, `publish(`user-${userId}`, { type: "notification.read.all" });`

- [ ] **Step 4: Run to verify it passes.** Run: `CI=true pnpm exec vitest run tests/unit/notifications.publish.test.ts` → PASS. Then run the existing notification tests to confirm no regression: `CI=true pnpm exec vitest run tests/unit/notifications*.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/notifications.ts tests/unit/notifications.publish.test.ts
git commit -m "feat(m4-p3): publish per-user events on notify/markRead/markAllRead"
```

---

### Task 3: Per-user SSE route `/api/notifications/stream`

**Goal:** An authenticated user gets an SSE stream of their notification events.

**Files:**
- Create: `app/api/notifications/stream/route.ts`
- Test: `tests/unit/notifications.stream.test.ts`

**Acceptance Criteria:**
- [ ] Unauthenticated → 401.
- [ ] Authenticated → `Content-Type: text/event-stream` response that emits `: connected` and forwards events published to `user-<id>`.

**Verify:** `CI=true pnpm exec vitest run tests/unit/notifications.stream.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test.** Read the first chunk of the stream and assert the connected comment + a forwarded event.

```ts
// tests/unit/notifications.stream.test.ts
import { describe, expect, test, vi } from "vitest";
import { GET } from "@/app/api/notifications/stream/route";
import * as authn from "@/lib/auth-helpers"; // confirm requireUser module path
import { publish } from "@/lib/events";

test("401 when unauthenticated", async () => {
  vi.spyOn(authn, "requireUser").mockResolvedValue(null as never);
  const res = await GET(new Request("http://t/api/notifications/stream"));
  expect(res.status).toBe(401);
});

test("streams connected + forwarded events for the user", async () => {
  vi.spyOn(authn, "requireUser").mockResolvedValue({ id: "u1" } as never);
  const res = await GET(new Request("http://t/api/notifications/stream"));
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const first = dec.decode((await reader.read()).value);
  expect(first).toContain(": connected");
  publish("user-u1", { type: "notification.read.all" });
  const next = dec.decode((await reader.read()).value);
  expect(next).toContain("notification.read.all");
  await reader.cancel();
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `CI=true pnpm exec vitest run tests/unit/notifications.stream.test.ts` → FAIL (`GET` not exported / route missing).

- [ ] **Step 3: Implement the route** — copy `app/api/documents/[id]/stream/route.ts` and adapt (no `id` param; user-scoped topic):

```ts
import { requireUser } from "@/lib/auth-helpers"; // match the import the per-document stream uses
import { subscribe, type DocEvent } from "@/lib/events";

export async function GET(_req: Request) {
  const user = await requireUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: DocEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      unsubscribe = subscribe(`user-${user.id}`, send);
      controller.enqueue(encoder.encode(`: connected\n\n`));
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(`: heartbeat\n\n`)), 25_000);
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
```

  (`DocEvent` is the bus's union — if it isn't exported, export it from `lib/events.ts`, matching how the per-document stream imports it.)

- [ ] **Step 4: Run to verify it passes.** Run: `CI=true pnpm exec vitest run tests/unit/notifications.stream.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/api/notifications/stream/route.ts lib/events.ts tests/unit/notifications.stream.test.ts
git commit -m "feat(m4-p3): per-user notifications SSE stream route"
```

---

### Task 4: `User.desktopNotifications` preference + migration

**Goal:** A per-user opt-in flag for OS notifications, defaulting off.

**Files:**
- Modify: `prisma/schema.prisma` (add field to `User`)
- Create: migration under `prisma/migrations/` (via `prisma migrate dev`)

**Acceptance Criteria:**
- [ ] `User.desktopNotifications Boolean @default(false)` exists; migration applies cleanly; `prisma generate` types include it.

**Verify:** `CI=true pnpm exec prisma migrate dev --name desktop_notifications` applies; `CI=true pnpm exec tsc --noEmit` clean.

**Steps:**

- [ ] **Step 1: Add the field** to the `User` model in `prisma/schema.prisma` (next to `emailNotifications`):

```prisma
  desktopNotifications Boolean @default(false)
```

- [ ] **Step 2: Create + apply the migration.** Run: `CI=true pnpm exec prisma migrate dev --name desktop_notifications`. Confirm a new folder appears under `prisma/migrations/` and `data/app.db` is updated.

- [ ] **Step 3: Verify types.** Run: `CI=true pnpm exec tsc --noEmit` → clean (the generated client now has the field).

- [ ] **Step 4: Commit.**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(m4-p3): add User.desktopNotifications preference (default off)"
```

---

### Task 5: Settings — desktop-notifications toggle + API

**Goal:** A settings toggle that requests browser permission and persists `desktopNotifications`.

**Files:**
- Modify: `app/api/settings/notifications/route.ts` (accept `desktopNotifications`)
- Modify: `components/NotificationSettings.tsx` (second toggle + permission request)
- Modify: `app/app/settings/notifications/page.tsx` (select + pass both prefs)
- Test: `tests/unit/settings.notifications.test.ts`

**Acceptance Criteria:**
- [ ] PATCH accepts either `emailNotifications` or `desktopNotifications` (boolean), updates only provided fields, 400 if neither present.
- [ ] Toggling desktop ON calls `Notification.requestPermission()`; if not granted, the toggle reverts and nothing persists.
- [ ] Page passes both current pref values to the component.

**Verify:** `CI=true pnpm exec vitest run tests/unit/settings.notifications.test.ts` → PASS; tsc + lint clean.

**Steps:**

- [ ] **Step 1: Write the failing API test.**

```ts
// tests/unit/settings.notifications.test.ts
import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { PATCH } from "@/app/api/settings/notifications/route";
import * as authn from "@/lib/auth-helpers";

async function makeUser(email: string) { return prisma.user.create({ data: { email, name: "x" } }); }
const req = (b: unknown) => new Request("http://t", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

describe("PATCH /api/settings/notifications", () => {
  beforeEach(async () => { await prisma.user.deleteMany(); });

  test("updates desktopNotifications", async () => {
    const u = await makeUser("a@example.com");
    vi.spyOn(authn, "requireUser").mockResolvedValue({ id: u.id } as never);
    const res = await PATCH(req({ desktopNotifications: true }));
    expect(res.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: u.id } }))?.desktopNotifications).toBe(true);
  });

  test("400 when neither field provided", async () => {
    const u = await makeUser("b@example.com");
    vi.spyOn(authn, "requireUser").mockResolvedValue({ id: u.id } as never);
    expect((await PATCH(req({}))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `CI=true pnpm exec vitest run tests/unit/settings.notifications.test.ts` → FAIL (only `emailNotifications` handled today).

- [ ] **Step 3: Update the API route** `app/api/settings/notifications/route.ts` to handle both fields:

```ts
const body = await req.json().catch(() => ({}));
const updates: { emailNotifications?: boolean; desktopNotifications?: boolean } = {};
if (typeof body.emailNotifications === "boolean") updates.emailNotifications = body.emailNotifications;
if (typeof body.desktopNotifications === "boolean") updates.desktopNotifications = body.desktopNotifications;
if (Object.keys(updates).length === 0) {
  return NextResponse.json({ error: "emailNotifications or desktopNotifications (boolean) required" }, { status: 400 });
}
await prisma.user.update({ where: { id: user.id }, data: updates });
return NextResponse.json({ ok: true, ...updates });
```

- [ ] **Step 4: Run to verify the API test passes.** Run: `CI=true pnpm exec vitest run tests/unit/settings.notifications.test.ts` → PASS.

- [ ] **Step 5: Update the component** `components/NotificationSettings.tsx` to accept an object initial and render a second toggle with the permission flow:

```tsx
export function NotificationSettings({ initial }: { initial: { email: boolean; desktop: boolean } }) {
  const [email, setEmail] = useState(initial.email);
  const [desktop, setDesktop] = useState(initial.desktop);
  const [saving, setSaving] = useState(false);

  async function save(patch: Record<string, boolean>, revert: () => void) {
    setSaving(true);
    await fetch("/api/settings/notifications", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
    }).catch(revert);
    setSaving(false);
  }
  async function toggleEmail() { const n = !email; setEmail(n); await save({ emailNotifications: n }, () => setEmail(!n)); }
  async function toggleDesktop() {
    const n = !desktop;
    if (n && typeof Notification !== "undefined" && (await Notification.requestPermission()) !== "granted") return; // revert: leave off
    setDesktop(n);
    await save({ desktopNotifications: n }, () => setDesktop(!n));
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">Notifications</h1>
      <label className="flex items-center gap-3 text-sm text-foreground">
        <input type="checkbox" data-testid="email-pref" checked={email} disabled={saving} onChange={toggleEmail} />
        Email me about activity on my documents
      </label>
      <label className="flex items-center gap-3 text-sm text-foreground">
        <input type="checkbox" data-testid="desktop-pref" checked={desktop} disabled={saving} onChange={toggleDesktop} />
        Show desktop notifications when Quorum is in the background
      </label>
    </div>
  );
}
```

  Preserve the existing `email-pref` testid and behavior.

- [ ] **Step 6: Update the page** `app/app/settings/notifications/page.tsx` to select and pass both prefs:

```tsx
const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { emailNotifications: true, desktopNotifications: true } });
return <NotificationSettings initial={{ email: u?.emailNotifications ?? true, desktop: u?.desktopNotifications ?? false }} />;
```

- [ ] **Step 7: Verify.** Run: `CI=true pnpm exec vitest run tests/unit/settings.notifications.test.ts && CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint` → all clean/PASS.

- [ ] **Step 8: Commit.**

```bash
git add app/api/settings/notifications/route.ts components/NotificationSettings.tsx app/app/settings/notifications/page.tsx tests/unit/settings.notifications.test.ts
git commit -m "feat(m4-p3): desktop-notifications settings toggle + API"
```

---

### Task 6: Pure client logic — unread reducer + OS-notify predicate

**Goal:** Testable pure functions for unread-count transitions and the "should I fire an OS notification" decision, decoupled from React/DOM.

**Files:**
- Create: `lib/notification-client.ts`
- Test: `tests/unit/notification-client.test.ts`

**Acceptance Criteria:**
- [ ] `nextUnread(count, event)` → `count+1` on `notification.created`, `max(0,count-1)` on `notification.read`, `0` on `notification.read.all`, unchanged otherwise.
- [ ] `shouldFireOsNotification({ desktopEnabled, permission, visibility, seen, id })` → true only when `desktopEnabled && permission==="granted" && visibility==="hidden" && !seen.has(id)`.

**Verify:** `CI=true pnpm exec vitest run tests/unit/notification-client.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/notification-client.test.ts
import { describe, expect, test } from "vitest";
import { nextUnread, shouldFireOsNotification } from "@/lib/notification-client";

describe("nextUnread", () => {
  test("transitions", () => {
    expect(nextUnread(2, { type: "notification.created" } as any)).toBe(3);
    expect(nextUnread(2, { type: "notification.read" } as any)).toBe(1);
    expect(nextUnread(0, { type: "notification.read" } as any)).toBe(0);
    expect(nextUnread(5, { type: "notification.read.all" } as any)).toBe(0);
    expect(nextUnread(5, { type: "version.created" } as any)).toBe(5);
  });
});

describe("shouldFireOsNotification", () => {
  const base = { desktopEnabled: true, permission: "granted" as const, visibility: "hidden" as const, seen: new Set<string>(), id: "n1" };
  test("fires only when all conditions hold", () => {
    expect(shouldFireOsNotification(base)).toBe(true);
    expect(shouldFireOsNotification({ ...base, desktopEnabled: false })).toBe(false);
    expect(shouldFireOsNotification({ ...base, permission: "default" })).toBe(false);
    expect(shouldFireOsNotification({ ...base, visibility: "visible" })).toBe(false);
    expect(shouldFireOsNotification({ ...base, seen: new Set(["n1"]) })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `CI=true pnpm exec vitest run tests/unit/notification-client.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `lib/notification-client.ts`.**

```ts
import type { DocEvent } from "@/lib/events";

export function nextUnread(count: number, e: DocEvent): number {
  switch (e.type) {
    case "notification.created": return count + 1;
    case "notification.read": return Math.max(0, count - 1);
    case "notification.read.all": return 0;
    default: return count;
  }
}

export function shouldFireOsNotification(args: {
  desktopEnabled: boolean;
  permission: NotificationPermission;
  visibility: DocumentVisibilityState;
  seen: Set<string>;
  id: string;
}): boolean {
  const { desktopEnabled, permission, visibility, seen, id } = args;
  return desktopEnabled && permission === "granted" && visibility === "hidden" && !seen.has(id);
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `CI=true pnpm exec vitest run tests/unit/notification-client.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/notification-client.ts tests/unit/notification-client.test.ts
git commit -m "feat(m4-p3): pure unread reducer + OS-notify predicate"
```

---

### Task 7: NotificationProvider — wire SSE, tab title, OS-notify; consume in AppNav + InboxList

**Goal:** A client provider mounted app-wide drives a live unread count (badge + tab title), fires OS notifications when appropriate, and feeds the inbox list live.

**Files:**
- Create: `components/NotificationProvider.tsx` (context + provider)
- Modify: `app/app/layout.tsx` (select desktop pref; mount provider seeding initial unread + desktopEnabled)
- Modify: `components/AppNav.tsx` (read unread from context, seeded by prop)
- Modify: `components/InboxList.tsx` (consume items/actions from context for live updates)

**Acceptance Criteria:**
- [ ] Provider opens `EventSource("/api/notifications/stream")` with the same reconnect pattern as `DocumentView` (close + 2 s retry on error; cleanup on unmount).
- [ ] `unread` starts at `initialUnread`, updates via `nextUnread` on each event; `document.title` is `"(N) Quorum AI"` when `N>0` else `"Quorum AI"`.
- [ ] On `notification.created`, fires `new Notification(...)` iff `shouldFireOsNotification(...)`; ids tracked in a ref to dedup.
- [ ] AppNav badge and InboxList reflect live state; existing `data-testid`/`aria-label` hooks preserved.

**Verify:** `CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint` clean; full unit suite green. Manual (two browser profiles / one backgrounded tab): an action by user A makes user B's badge + tab title update live; with desktop pref on and tab hidden, an OS notification appears. Optional light e2e below.

**Steps:**

- [ ] **Step 1: Create `components/NotificationProvider.tsx`.** A `"use client"` context provider. Seed from props; reuse the EventSource pattern from `components/DocumentView.tsx:236-271`.

```tsx
"use client";
import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import type { DocEvent, ClientNotification } from "@/lib/events";
import { nextUnread, shouldFireOsNotification } from "@/lib/notification-client";

interface Ctx {
  unread: number;
  items: ClientNotification[];
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}
const NotificationContext = createContext<Ctx | null>(null);
export function useNotifications(): Ctx {
  const c = useContext(NotificationContext);
  if (!c) throw new Error("useNotifications must be used within NotificationProvider");
  return c;
}

export function NotificationProvider({
  initialUnread, desktopEnabled, initialItems = [], children,
}: { initialUnread: number; desktopEnabled: boolean; initialItems?: ClientNotification[]; children: React.ReactNode }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<ClientNotification[]>(initialItems);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    function connect() {
      es = new EventSource("/api/notifications/stream");
      es.onmessage = (ev) => {
        const e = JSON.parse(ev.data) as DocEvent;
        setUnread((u) => nextUnread(u, e));
        if (e.type === "notification.created") {
          setItems((prev) => [e.notification, ...prev]);
          if (shouldFireOsNotification({
            desktopEnabled,
            permission: typeof Notification !== "undefined" ? Notification.permission : "denied",
            visibility: document.visibilityState,
            seen: seen.current,
            id: e.notification.id,
          })) {
            seen.current.add(e.notification.id);
            new Notification(e.notification.documentTitle || "Quorum AI", { body: `New ${e.notification.type}` });
          }
        } else if (e.type === "notification.read") {
          setItems((prev) => prev.map((n) => (n.id === e.id ? { ...n, read: true } : n)));
        } else if (e.type === "notification.read.all") {
          setItems((prev) => prev.map((n) => ({ ...n, read: true })));
        }
      };
      es.onerror = () => { es?.close(); if (!stopped) retry = setTimeout(connect, 2000); };
    }
    connect();
    return () => { stopped = true; es?.close(); if (retry) clearTimeout(retry); };
  }, [desktopEnabled]);

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Quorum AI` : "Quorum AI";
  }, [unread]);

  const markRead = useCallback(async (id: string) => {
    setUnread((u) => Math.max(0, u - 1));
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await fetch("/api/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
  }, []);
  const markAllRead = useCallback(async () => {
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true }) });
  }, []);

  return <NotificationContext.Provider value={{ unread, items, markRead, markAllRead }}>{children}</NotificationContext.Provider>;
}
```

  (Confirm the PATCH `/api/notifications` body shape — `{ id }` / `{ all: true }` — against the existing `InboxList`/route; match it exactly.)

- [ ] **Step 2: Mount in `app/app/layout.tsx`.** Select the desktop pref alongside `unreadCount`, wrap children + nav in the provider:

```tsx
import { NotificationProvider } from "@/components/NotificationProvider";
import { prisma } from "@/lib/prisma";
// ...
const unread = await unreadCount(session.user.id);
const pref = await prisma.user.findUnique({ where: { id: session.user.id }, select: { desktopNotifications: true } });
return (
  <NotificationProvider initialUnread={unread} desktopEnabled={pref?.desktopNotifications ?? false}>
    <div className="min-h-screen bg-background">
      <AppNav email={session.user.email} unread={unread} />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  </NotificationProvider>
);
```

- [ ] **Step 3: AppNav consumes context.** In `components/AppNav.tsx`, read live unread from context, falling back to the prop for first paint. Make it a client component if it isn't already (`"use client"`). Keep the existing badge JSX/testids:

```tsx
import { useNotifications } from "@/components/NotificationProvider";
// inside the component:
const { unread: liveUnread } = useNotifications();
const badge = liveUnread; // replaces the `unread` prop usage in the badge expression
```

  Replace the badge's `unread > 0 && ...` with `badge > 0 && ...`. Keep the `unread` prop for SSR seed (provider already seeds the same value, so either is fine; using context keeps it live).

- [ ] **Step 4: InboxList consumes context.** In `components/InboxList.tsx`, source the list + actions from `useNotifications()` so it updates live, seeding from its existing server-fetched initial items if it has any. Replace its local `onOpen`/`onMarkAll` fetch calls with the context's `markRead`/`markAllRead`. Preserve TYPE_LABELS and existing testids.

- [ ] **Step 5: Verify.** Run: `CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint && CI=true pnpm exec vitest run` → all clean/green. Then the manual two-tab check in **Verify**.

- [ ] **Step 6 (optional light e2e):** Extend an e2e spec: log in as two users in two contexts; user A comments on a shared doc; assert user B's inbox badge increments without reload. (OS-notify firing isn't asserted in e2e — it's covered by Task 6's predicate.) Free port 3000 first.

- [ ] **Step 7: Commit.**

```bash
git add components/NotificationProvider.tsx app/app/layout.tsx components/AppNav.tsx components/InboxList.tsx tests/e2e/
git commit -m "feat(m4-p3): live NotificationProvider — SSE, tab title, OS-notify, live inbox"
```

---

## Self-Review

- **Spec coverage:** bus variants → T1; publish points → T2; SSE route → T3; `desktopNotifications` migration → T4; settings toggle+API → T5; pure unread/predicate → T6; provider + title + OS-notify + AppNav/InboxList wiring → T7. All spec "Files touched" are covered.
- **Type/name consistency:** `ClientNotification` + `DocEvent` defined/exported in T1, consumed in T2/T3/T6/T7; `nextUnread`/`shouldFireOsNotification` defined in T6, used in T7; `NotificationProvider`/`useNotifications` defined in T7, consumed by AppNav/InboxList in the same task.
- **Placeholders:** none — code shown for every code step. "Confirm import path / PATCH body shape against existing code" are verification instructions, not deferred work.

**Dependencies:** T2 blockedBy T1; T3 blockedBy T1; T5 blockedBy T4; T6 blockedBy T1; T7 blockedBy T2, T3, T5, T6.
