# M6 · P2 — Granular Per-Type Notification Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two global `User` booleans (`emailNotifications`, `desktopNotifications`) with a per-(type × channel) notification preference matrix stored as a JSON column, wired through dispatch, client desktop firing, the settings API, and a settings-matrix UI.

**Architecture:** A pure `lib/notification-prefs.ts` helper owns the matrix (types × channels), defaults, parsing, validation, and the single `isEnabled` decision. Preferences live in a `User.notificationPrefs Json?` column (read whole, decided in app code — no join). The migration adds the column + backfills from the old booleans first; the booleans are dropped only in the final task, once nothing references them, so every intermediate commit compiles and the test/prod DBs preserve existing users' settings.

**Tech Stack:** Next.js 16, React 19, Prisma 7.8 + SQLite (native `Json` scalar supported), Vitest (real test DB), Playwright e2e.

**User decisions (already made):**
- Full 3-channel matrix — in-app is per-type muteable too (muting in-app = no `Notification` row created).
- `resolve` stays non-emailable (no email cell).
- Schema option A: JSON column on `User` + pure helper (not a side table).
- Migration drops `emailNotifications` + `desktopNotifications` after backfilling into `notificationPrefs`.
- Desktop firing stays coupled to in-app (no event published when in-app muted → desktop can't fire); treated as intuitive, not special-cased.

---

### Task 1: Matrix value-sets + pure `notification-prefs` helper

**Goal:** Add the type/channel value-sets to `lib/enums.ts` and a pure, fully-tested `lib/notification-prefs.ts` (defaults, parse, isEnabled, isValidCell, applyPatch).

**Files:**
- Modify: `lib/enums.ts` (append the value-sets)
- Create: `lib/notification-prefs.ts`
- Test: `tests/unit/notification-prefs.test.ts`

**Acceptance Criteria:**
- [ ] `NOTIFICATION_TYPES`, `NOTIFICATION_CHANNELS`, `NOTIFICATION_CELLS` exported from `lib/enums.ts`.
- [ ] `DEFAULT_PREFS` preserves today's behavior (inApp all true; email comment/review/version true; desktop all false; resolve has no email key).
- [ ] `parsePrefs(unknown)` merges over defaults, ignores unknown types/channels and non-booleans, and never throws.
- [ ] `isEnabled`, `isValidCell` (rejects `resolve`+`email` and any unknown cell), `applyPatch` (validates, returns a new object, throws on invalid cell).
- [ ] All covered by unit tests.

**Verify:** `CI=true pnpm test:unit notification-prefs` → all pass.

**Steps:**

- [ ] **Step 1: Append value-sets to `lib/enums.ts`**

```ts
export const NOTIFICATION_TYPES = ["comment", "review", "version", "resolve"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["inApp", "email", "desktop"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// Which channels exist per type. `resolve` is never emailed.
export const NOTIFICATION_CELLS: Record<NotificationType, readonly NotificationChannel[]> = {
  comment: ["inApp", "email", "desktop"],
  review: ["inApp", "email", "desktop"],
  version: ["inApp", "email", "desktop"],
  resolve: ["inApp", "desktop"],
};
```

- [ ] **Step 2: Write the failing test** `tests/unit/notification-prefs.test.ts`

```ts
import { describe, expect, test } from "vitest";
import {
  DEFAULT_PREFS,
  parsePrefs,
  isEnabled,
  isValidCell,
  applyPatch,
} from "@/lib/notification-prefs";

describe("DEFAULT_PREFS preserves prior behavior", () => {
  test("inApp on, email on for c/r/v, desktop off, resolve has no email", () => {
    for (const t of ["comment", "review", "version", "resolve"] as const) {
      expect(DEFAULT_PREFS[t].inApp).toBe(true);
      expect(DEFAULT_PREFS[t].desktop).toBe(false);
    }
    expect(DEFAULT_PREFS.comment.email).toBe(true);
    expect(DEFAULT_PREFS.review.email).toBe(true);
    expect(DEFAULT_PREFS.version.email).toBe(true);
    expect("email" in DEFAULT_PREFS.resolve).toBe(false);
  });
});

describe("parsePrefs", () => {
  test("null/garbage → defaults (never throws)", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(42)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("x")).toEqual(DEFAULT_PREFS);
  });
  test("merges known boolean cells, ignores unknown keys + non-booleans", () => {
    const p = parsePrefs({
      comment: { email: false, desktop: true, bogusChannel: true },
      bogusType: { inApp: false },
      review: { email: "nope" },
    });
    expect(p.comment.email).toBe(false);
    expect(p.comment.desktop).toBe(true);
    expect(p.comment.inApp).toBe(true); // untouched default
    expect(p.review.email).toBe(true); // non-boolean ignored → default
    expect((p as Record<string, unknown>).bogusType).toBeUndefined();
    expect((p.comment as Record<string, unknown>).bogusChannel).toBeUndefined();
  });
  test("resolve email is never set even if present in input", () => {
    const p = parsePrefs({ resolve: { email: true } });
    expect("email" in p.resolve).toBe(false);
  });
});

describe("isEnabled", () => {
  test("reads the cell, false for missing", () => {
    expect(isEnabled(DEFAULT_PREFS, "comment", "inApp")).toBe(true);
    expect(isEnabled(DEFAULT_PREFS, "comment", "desktop")).toBe(false);
    expect(isEnabled(DEFAULT_PREFS, "resolve", "email")).toBe(false);
  });
});

describe("isValidCell", () => {
  test("true for real cells, false for resolve+email and unknowns", () => {
    expect(isValidCell("comment", "email")).toBe(true);
    expect(isValidCell("resolve", "desktop")).toBe(true);
    expect(isValidCell("resolve", "email")).toBe(false);
    expect(isValidCell("bogus", "inApp")).toBe(false);
    expect(isValidCell("comment", "bogus")).toBe(false);
  });
});

describe("applyPatch", () => {
  test("sets one cell immutably", () => {
    const next = applyPatch(DEFAULT_PREFS, "comment", "email", false);
    expect(next.comment.email).toBe(false);
    expect(DEFAULT_PREFS.comment.email).toBe(true); // original untouched
  });
  test("throws on invalid cell", () => {
    expect(() => applyPatch(DEFAULT_PREFS, "resolve", "email", true)).toThrow();
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `CI=true pnpm test:unit notification-prefs`
Expected: FAIL (module `@/lib/notification-prefs` not found).

- [ ] **Step 4: Implement `lib/notification-prefs.ts`**

```ts
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CELLS,
  type NotificationType,
  type NotificationChannel,
} from "@/lib/enums";

export type ChannelFlags = Partial<Record<NotificationChannel, boolean>>;
export type NotificationPrefs = Record<NotificationType, ChannelFlags>;

export const DEFAULT_PREFS: NotificationPrefs = {
  comment: { inApp: true, email: true, desktop: false },
  review: { inApp: true, email: true, desktop: false },
  version: { inApp: true, email: true, desktop: false },
  resolve: { inApp: true, desktop: false },
};

/** A fresh deep copy of DEFAULT_PREFS (so callers never mutate the shared default). */
function freshDefaults(): NotificationPrefs {
  return {
    comment: { ...DEFAULT_PREFS.comment },
    review: { ...DEFAULT_PREFS.review },
    version: { ...DEFAULT_PREFS.version },
    resolve: { ...DEFAULT_PREFS.resolve },
  };
}

/** True only for cells that exist in the matrix (rejects resolve+email and unknowns). */
export function isValidCell(type: string, channel: string): boolean {
  const channels = NOTIFICATION_CELLS[type as NotificationType] as readonly string[] | undefined;
  return !!channels && channels.includes(channel);
}

/** Merge stored JSON over defaults; ignore unknown types/channels + non-booleans. Never throws. */
export function parsePrefs(json: unknown): NotificationPrefs {
  const out = freshDefaults();
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const type of NOTIFICATION_TYPES) {
      const cell = obj[type];
      if (cell && typeof cell === "object") {
        const cellObj = cell as Record<string, unknown>;
        for (const channel of NOTIFICATION_CELLS[type]) {
          const v = cellObj[channel];
          if (typeof v === "boolean") out[type][channel] = v;
        }
      }
    }
  }
  return out;
}

export function isEnabled(
  prefs: NotificationPrefs,
  type: NotificationType,
  channel: NotificationChannel,
): boolean {
  return prefs[type]?.[channel] === true;
}

/** Return a new prefs object with one cell set. Throws on an invalid cell. */
export function applyPatch(
  prefs: NotificationPrefs,
  type: NotificationType,
  channel: NotificationChannel,
  enabled: boolean,
): NotificationPrefs {
  if (!isValidCell(type, channel)) throw new Error(`invalid notification cell: ${type}.${channel}`);
  return { ...prefs, [type]: { ...prefs[type], [channel]: enabled } };
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `CI=true pnpm test:unit notification-prefs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add lib/enums.ts lib/notification-prefs.ts tests/unit/notification-prefs.test.ts
/usr/bin/git commit -m "feat(m6-p2): notification prefs matrix value-sets + pure helper"
```

---

### Task 2: Schema — add `notificationPrefs` JSON + backfill (keep booleans)

**Goal:** Add `User.notificationPrefs Json?` and a migration that backfills it from the two existing booleans. The booleans stay for now (dropped in Task 7) so every intermediate commit compiles.

**Files:**
- Modify: `prisma/schema.prisma` (User model)
- Create: `prisma/migrations/<timestamp>_add_notification_prefs/migration.sql` (generated, then hand-edit to add the backfill)

**Acceptance Criteria:**
- [ ] `User.notificationPrefs Json?` added; `emailNotifications` + `desktopNotifications` still present.
- [ ] Migration adds the column AND backfills every existing row from the two booleans (JSON booleans, not 0/1).
- [ ] `pnpm exec prisma generate` succeeds; `npx tsc --noEmit` is clean (no code references the new column yet).

**Verify:** `pnpm exec prisma migrate status` shows the new migration applied; `npx tsc --noEmit` → 0 errors.

**Steps:**

- [ ] **Step 1: Edit `prisma/schema.prisma`** — add the field to `User` (next to the existing booleans, which stay):

```prisma
  emailNotifications Boolean @default(true)
  desktopNotifications Boolean @default(false)
  notificationPrefs Json?
```

- [ ] **Step 2: Generate the migration without applying**

```bash
pnpm exec prisma migrate dev --name add_notification_prefs --create-only
```
This writes `prisma/migrations/<ts>_add_notification_prefs/migration.sql` containing an `ALTER TABLE "User" ADD COLUMN "notificationPrefs" JSONB;` (or TEXT). Do NOT apply yet.

- [ ] **Step 3: Append the backfill to that `migration.sql`** (use the Edit/Write tool to add below the ADD COLUMN line). This stores real JSON booleans via `json(...)`:

```sql
-- Backfill per-type prefs from the legacy global booleans.
UPDATE "User"
SET "notificationPrefs" = json_object(
  'comment', json_object('inApp', json('true'), 'email',   json(CASE WHEN "emailNotifications" = 1 THEN 'true' ELSE 'false' END), 'desktop', json(CASE WHEN "desktopNotifications" = 1 THEN 'true' ELSE 'false' END)),
  'review',  json_object('inApp', json('true'), 'email',   json(CASE WHEN "emailNotifications" = 1 THEN 'true' ELSE 'false' END), 'desktop', json(CASE WHEN "desktopNotifications" = 1 THEN 'true' ELSE 'false' END)),
  'version', json_object('inApp', json('true'), 'email',   json(CASE WHEN "emailNotifications" = 1 THEN 'true' ELSE 'false' END), 'desktop', json(CASE WHEN "desktopNotifications" = 1 THEN 'true' ELSE 'false' END)),
  'resolve', json_object('inApp', json('true'), 'desktop', json(CASE WHEN "desktopNotifications" = 1 THEN 'true' ELSE 'false' END))
)
WHERE "notificationPrefs" IS NULL;
```

- [ ] **Step 4: Apply + regenerate the client**

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```
Expected: migration applies cleanly; client regenerated.

- [ ] **Step 5: Confirm compile is still green**

```bash
npx tsc --noEmit
```
Expected: 0 errors (no source references `notificationPrefs` yet; the booleans still exist for current code).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add prisma/schema.prisma prisma/migrations
/usr/bin/git commit -m "feat(m6-p2): add User.notificationPrefs JSON column + backfill migration"
```

---

### Task 3: Dispatch filtering in `notifyParticipants`

**Goal:** Make `lib/notifications.ts` consult per-type prefs — create the in-app `Notification` only when `inApp` is enabled, enqueue email only when emailable AND `email` is enabled. Update the existing dispatch tests for the new model.

**Files:**
- Modify: `lib/notifications.ts:7-44` (`notifyParticipants`)
- Modify (tests): `tests/unit/notifications.test.ts`

**Acceptance Criteria:**
- [ ] Participant query selects `notificationPrefs` (not `emailNotifications`).
- [ ] In-app row + publish happen only when `isEnabled(prefs, type, "inApp")`.
- [ ] Email enqueued only when `EMAILABLE.has(type) && isEnabled(prefs, type, "email")`.
- [ ] `tests/unit/notifications.test.ts` updated: the email opt-out case sets `notificationPrefs` (not the dropped boolean); a new case asserts in-app muting prevents the `Notification` row.

**Verify:** `CI=true pnpm test:unit notifications.test` → all pass.

**Steps:**

- [ ] **Step 1: Rewrite `notifyParticipants` in `lib/notifications.ts`** (replace the function body; keep the other exports unchanged). New imports at top: `import { parsePrefs, isEnabled } from "@/lib/notification-prefs";` and `import type { NotificationType } from "@/lib/enums";`

```ts
export async function notifyParticipants(documentId: string, actorId: string, type: string) {
  const participants = await prisma.documentParticipant.findMany({
    where: { documentId },
    select: { userId: true, user: { select: { notificationPrefs: true } } },
  });
  const recipients = participants.filter((p) => p.userId !== actorId);
  if (recipients.length === 0) return;

  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { title: true } });
  const documentTitle = doc?.title ?? "";

  const nt = type as NotificationType;
  let actorName: string | null = null; // resolved lazily, only if an email is enqueued

  for (const p of recipients) {
    const prefs = parsePrefs(p.user?.notificationPrefs);

    // In-app: create + publish only if enabled for this type.
    if (isEnabled(prefs, nt, "inApp")) {
      const row = await prisma.notification.create({
        data: { userId: p.userId, documentId, actorId, type },
      });
      const payload: ClientNotification = {
        id: row.id,
        type: row.type,
        documentId,
        documentTitle,
        actorId: row.actorId,
        read: row.read,
        createdAt: row.createdAt.toISOString(),
      };
      publish(`user-${p.userId}`, { type: "notification.created", notification: payload });
    }

    // Email: only emailable types, and only if enabled for this recipient.
    if (EMAILABLE.has(type) && isEnabled(prefs, nt, "email")) {
      if (actorName === null) {
        const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
        actorName = actor?.name ?? "Someone";
      }
      enqueueEmailEvent(p.userId, documentId, type as "comment" | "review" | "version", actorName);
    }
  }
}
```

- [ ] **Step 2: Update `tests/unit/notifications.test.ts`** — the email opt-out test currently does `prisma.user.update({ ... data: { emailNotifications: false } })`. Replace that line with a `notificationPrefs` write, and add an in-app mute test. Change the opt-out setup line to:

```ts
await prisma.user.update({
  where: { id: optedOut.id },
  data: { notificationPrefs: { comment: { inApp: true, email: false, desktop: false } } },
});
```

Add this test inside the `describe("notifications", ...)` block:

```ts
it("does not create an in-app notification when inApp is muted for the type", async () => {
  const actor = await makeUser();
  const muted = await makeUser();
  await prisma.user.update({
    where: { id: muted.id },
    data: { notificationPrefs: { comment: { inApp: false, email: false, desktop: false } } },
  });
  const docId = await createDocument(actor.id, "Plan", "Some body text.");
  await prisma.documentParticipant.create({ data: { documentId: docId, userId: muted.id } });

  await notifyParticipants(docId, actor.id, "comment");
  expect(await unreadCount(muted.id)).toBe(0);
  expect(await listNotifications(muted.id)).toHaveLength(0);

  await prisma.document.delete({ where: { id: docId } });
});
```

- [ ] **Step 3: Run the tests**

Run: `CI=true pnpm test:unit notifications.test`
Expected: PASS (opt-out via prefs; in-app mute suppresses the row; resolve still never emails).

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add lib/notifications.ts tests/unit/notifications.test.ts
/usr/bin/git commit -m "feat(m6-p2): per-type dispatch filtering in notifyParticipants"
```

---

### Task 4: Client desktop firing per-type

**Goal:** Drive desktop/OS notifications from per-type prefs. `app/app/layout.tsx` passes the desktop column; `NotificationProvider` + `shouldFireOsNotification` decide per `notification.type`.

**Files:**
- Modify: `lib/notification-client.ts` (`shouldFireOsNotification`)
- Modify: `components/NotificationProvider.tsx` (prop + call site)
- Modify: `app/app/layout.tsx` (source the desktop prefs)
- Modify (tests): `tests/unit/notification-client.test.ts`

**Acceptance Criteria:**
- [ ] `shouldFireOsNotification` takes `desktopPrefs: Record<string, boolean>` + the event `type`, and fires only if that type's desktop pref is true (plus the existing permission/visibility/seen guards).
- [ ] `NotificationProvider` prop is `desktopPrefs` (replacing `desktopEnabled`); the fire site passes `e.notification.type`.
- [ ] `app/app/layout.tsx` selects `notificationPrefs`, parses it, and passes `desktopPrefs` (the per-type desktop column).
- [ ] `tests/unit/notification-client.test.ts` updated for the new signature.

**Verify:** `CI=true pnpm test:unit notification-client` → pass; `npx tsc --noEmit` → 0.

**Steps:**

- [ ] **Step 1: Update `shouldFireOsNotification` in `lib/notification-client.ts`** (replace the function; `nextUnread` unchanged):

```ts
export function shouldFireOsNotification(args: {
  desktopPrefs: Record<string, boolean>;
  type: string;
  permission: NotificationPermission;
  visibility: DocumentVisibilityState;
  seen: Set<string>;
  id: string;
}): boolean {
  const { desktopPrefs, type, permission, visibility, seen, id } = args;
  return (
    desktopPrefs[type] === true &&
    permission === "granted" &&
    visibility === "hidden" &&
    !seen.has(id)
  );
}
```

- [ ] **Step 2: Update `tests/unit/notification-client.test.ts`** — replace the `shouldFireOsNotification` describe block:

```ts
describe("shouldFireOsNotification", () => {
  const base = {
    desktopPrefs: { comment: true } as Record<string, boolean>,
    type: "comment",
    permission: "granted" as const,
    visibility: "hidden" as const,
    seen: new Set<string>(),
    id: "n1",
  };
  test("fires only when the type's desktop pref is on and all guards hold", () => {
    expect(shouldFireOsNotification(base)).toBe(true);
    expect(shouldFireOsNotification({ ...base, desktopPrefs: { comment: false } })).toBe(false);
    expect(shouldFireOsNotification({ ...base, type: "review" })).toBe(false); // not in prefs map
    expect(shouldFireOsNotification({ ...base, permission: "default" })).toBe(false);
    expect(shouldFireOsNotification({ ...base, visibility: "visible" })).toBe(false);
    expect(shouldFireOsNotification({ ...base, seen: new Set(["n1"]) })).toBe(false);
  });
});
```

- [ ] **Step 3: Update `components/NotificationProvider.tsx`** — change the prop type and the fire site. Replace `desktopEnabled: boolean` in the props interface with `desktopPrefs: Record<string, boolean>`; update the destructure (`desktopEnabled` → `desktopPrefs`), the `useEffect` dependency array (`[desktopEnabled]` → `[desktopPrefs]`), and the `shouldFireOsNotification` call:

```tsx
if (
  shouldFireOsNotification({
    desktopPrefs,
    type: e.notification.type,
    permission: typeof Notification !== "undefined" ? Notification.permission : "denied",
    visibility: document.visibilityState,
    seen: seen.current,
    id: e.notification.id,
  })
) {
```

- [ ] **Step 4: Update `app/app/layout.tsx`** — change the prefs query + prop. Replace the `prisma.user.findUnique` select and the `NotificationProvider` prop:

```tsx
import { parsePrefs } from "@/lib/notification-prefs";
import { NOTIFICATION_TYPES } from "@/lib/enums";
// ...
const [unread, rows, pref] = await Promise.all([
  unreadCount(session.user.id),
  listNotifications(session.user.id),
  prisma.user.findUnique({ where: { id: session.user.id }, select: { notificationPrefs: true } }),
]);
const prefs = parsePrefs(pref?.notificationPrefs);
const desktopPrefs = Object.fromEntries(
  NOTIFICATION_TYPES.map((t) => [t, prefs[t].desktop === true]),
) as Record<string, boolean>;
// ...
<NotificationProvider initialUnread={unread} desktopPrefs={desktopPrefs} initialItems={initialItems}>
```

- [ ] **Step 5: Run tests + typecheck**

```bash
CI=true pnpm test:unit notification-client
npx tsc --noEmit
```
Expected: tests pass; 0 type errors.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add lib/notification-client.ts components/NotificationProvider.tsx app/app/layout.tsx tests/unit/notification-client.test.ts
/usr/bin/git commit -m "feat(m6-p2): per-type desktop notification firing"
```

---

### Task 5: Settings API — per-cell PATCH

**Goal:** Replace the two-boolean PATCH body with a validated per-cell `{ type, channel, enabled }` patch that updates `notificationPrefs`. Rewrite its unit test.

**Files:**
- Modify: `app/api/settings/notifications/route.ts`
- Modify (tests): `tests/unit/settings.notifications.test.ts`

**Acceptance Criteria:**
- [ ] Body `{ type, channel, enabled }`; **400** on unknown type/channel, non-boolean `enabled`, or the `resolve`+`email` cell (`isValidCell`).
- [ ] On success: load prefs (`parsePrefs`), `applyPatch`, persist `notificationPrefs`, return `{ ok: true, prefs }` (200).
- [ ] Unit test rewritten: valid cell persists; `resolve`+`email` → 400; unknown cell → 400; non-boolean → 400.

**Verify:** `CI=true pnpm test:unit settings.notifications` → all pass.

**Steps:**

- [ ] **Step 1: Rewrite `app/api/settings/notifications/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { parsePrefs, applyPatch, isValidCell } from "@/lib/notification-prefs";
import type { NotificationType, NotificationChannel } from "@/lib/enums";

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { type, channel, enabled } = body as { type?: unknown; channel?: unknown; enabled?: unknown };

  if (typeof type !== "string" || typeof channel !== "string" || typeof enabled !== "boolean" || !isValidCell(type, channel)) {
    return NextResponse.json(
      { error: "body must be { type, channel, enabled } for a valid notification cell" },
      { status: 400 },
    );
  }

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { notificationPrefs: true } });
  const prefs = applyPatch(parsePrefs(row?.notificationPrefs), type as NotificationType, channel as NotificationChannel, enabled);
  await prisma.user.update({ where: { id: user.id }, data: { notificationPrefs: prefs } });
  return NextResponse.json({ ok: true, prefs });
}
```

- [ ] **Step 2: Rewrite `tests/unit/settings.notifications.test.ts`** (keep the `makeUser`/`req`/`requireUser` mock scaffolding; replace the test bodies):

```ts
import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PATCH } from "@/app/api/settings/notifications/route";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

async function makeUser(label: string) {
  const now = new Date();
  return prisma.user.create({
    data: {
      id: `u-${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      name: "x",
      email: `u-${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
  });
}
const req = (b: unknown) =>
  new Request("http://t", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

describe("PATCH /api/settings/notifications", () => {
  beforeEach(() => vi.mocked(api.requireUser).mockReset());

  test("updates a valid cell and persists", async () => {
    const u = await makeUser("a");
    vi.mocked(api.requireUser).mockResolvedValue({ id: u.id } as never);
    const res = await PATCH(req({ type: "comment", channel: "email", enabled: false }));
    expect(res.status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { notificationPrefs: true } });
    const prefs = row?.notificationPrefs as Record<string, Record<string, boolean>>;
    expect(prefs.comment.email).toBe(false);
    expect(prefs.comment.inApp).toBe(true); // default preserved
  });

  test("400 on the resolve+email cell", async () => {
    const u = await makeUser("b");
    vi.mocked(api.requireUser).mockResolvedValue({ id: u.id } as never);
    expect((await PATCH(req({ type: "resolve", channel: "email", enabled: true }))).status).toBe(400);
  });

  test("400 on unknown type/channel and non-boolean enabled", async () => {
    const u = await makeUser("c");
    vi.mocked(api.requireUser).mockResolvedValue({ id: u.id } as never);
    expect((await PATCH(req({ type: "bogus", channel: "email", enabled: true }))).status).toBe(400);
    expect((await PATCH(req({ type: "comment", channel: "bogus", enabled: true }))).status).toBe(400);
    expect((await PATCH(req({ type: "comment", channel: "email", enabled: "yes" }))).status).toBe(400);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `CI=true pnpm test:unit settings.notifications`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add app/api/settings/notifications/route.ts tests/unit/settings.notifications.test.ts
/usr/bin/git commit -m "feat(m6-p2): per-cell PATCH for notification prefs"
```

---

### Task 6: Settings matrix UI + e2e rewrite

**Goal:** Replace the two-checkbox `NotificationSettings` with the type×channel matrix; load prefs in the page; rewrite the e2e pref test.

**Files:**
- Modify: `components/NotificationSettings.tsx`
- Modify: `app/app/settings/notifications/page.tsx`
- Modify (tests): `tests/e2e/notifications-pref.spec.ts`

**Acceptance Criteria:**
- [ ] Matrix: rows = types (with labels), columns = In-app / Email / Desktop; the `resolve`×Email cell is rendered disabled (visually present but non-interactive) so the grid stays aligned.
- [ ] Each checkbox PATCHes its cell `{ type, channel, enabled }` (optimistic, revert on failure); enabling any **desktop** cell when `Notification.permission !== "granted"` requests permission first and leaves the cell off if denied.
- [ ] Per-cell testids `pref-<type>-<channel>` (e.g. `pref-comment-email`, `pref-resolve-desktop`); SMTP helper copy retained.
- [ ] Page passes the full parsed prefs; e2e test rewritten for the matrix and green.

**Verify:** `npx tsc --noEmit` → 0; `pnpm lint` → 0; (e2e runs in Task 7's full gate).

**Steps:**

- [ ] **Step 1: Rewrite `components/NotificationSettings.tsx`**

```tsx
"use client";
import { useState } from "react";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  type NotificationType,
  type NotificationChannel,
} from "@/lib/enums";
import { isValidCell, type NotificationPrefs } from "@/lib/notification-prefs";

const TYPE_LABELS: Record<NotificationType, string> = {
  comment: "Comments & replies",
  review: "Reviews & verdicts",
  version: "New versions",
  resolve: "Thread resolved",
};
const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  inApp: "In-app",
  email: "Email",
  desktop: "Desktop",
};

export function NotificationSettings({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  const [saving, setSaving] = useState(false);

  async function toggle(type: NotificationType, channel: NotificationChannel) {
    const current = prefs[type]?.[channel] === true;
    const next = !current;

    // Desktop opt-in requires OS permission.
    if (channel === "desktop" && next && typeof Notification !== "undefined" && (await Notification.requestPermission()) !== "granted") {
      return; // permission denied → leave off, persist nothing
    }

    const prev = prefs;
    setPrefs((p) => ({ ...p, [type]: { ...p[type], [channel]: next } }));
    setSaving(true);
    const res = await fetch("/api/settings/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, channel, enabled: next }),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) setPrefs(prev); // revert on failure
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">Notifications</h1>
      <p className="text-sm text-muted">Choose how you&apos;re notified for each kind of activity on your documents.</p>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-muted">
              <th className="p-2 text-left font-medium">Activity</th>
              {NOTIFICATION_CHANNELS.map((c) => (
                <th key={c} className="p-2 text-center font-medium">{CHANNEL_LABELS[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TYPES.map((type) => (
              <tr key={type} className="border-t border-border">
                <td className="p-2 text-foreground">{TYPE_LABELS[type]}</td>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const exists = isValidCell(type, channel);
                  return (
                    <td key={channel} className="p-2 text-center">
                      <input
                        type="checkbox"
                        data-testid={`pref-${type}-${channel}`}
                        className="accent-[var(--primary)]"
                        checked={prefs[type]?.[channel] === true}
                        disabled={!exists || saving}
                        aria-label={`${TYPE_LABELS[type]} — ${CHANNEL_LABELS[channel]}`}
                        onChange={() => exists && toggle(type, channel)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">Emails are only sent when the server has SMTP configured.</p>
    </div>
  );
}
```
> Note: imports must match actual exports (`NOTIFICATION_TYPES`, `NOTIFICATION_CHANNELS`, `NotificationType`, `NotificationChannel` from `@/lib/enums`; `isValidCell`, `NotificationPrefs` from `@/lib/notification-prefs`). `npx tsc --noEmit` catches any mismatch.

- [ ] **Step 2: Update `app/app/settings/notifications/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { NotificationSettings } from "@/components/NotificationSettings";
import { parsePrefs } from "@/lib/notification-prefs";

export default async function NotificationsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { notificationPrefs: true },
  });
  return <NotificationSettings initial={parsePrefs(user?.notificationPrefs)} />;
}
```

- [ ] **Step 3: Rewrite `tests/e2e/notifications-pref.spec.ts`** for the matrix

```ts
import { test, expect } from "@playwright/test";

test("per-type notification prefs persist", async ({ page }) => {
  const email = `pref-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Pref User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);

  await page.goto("/app/settings/notifications");

  const commentEmail = page.getByTestId("pref-comment-email");
  await expect(commentEmail).toBeChecked(); // default on

  // resolve+email cell exists but is disabled (non-emailable).
  await expect(page.getByTestId("pref-resolve-email")).toBeDisabled();
  // in-app defaults on for all types.
  await expect(page.getByTestId("pref-version-inApp")).toBeChecked();

  const saved = page.waitForResponse(
    (r) => r.url().includes("/api/settings/notifications") && r.request().method() === "PATCH",
  );
  await commentEmail.click();
  await expect(commentEmail).not.toBeChecked();
  await saved;

  await page.reload();
  await expect(page.getByTestId("pref-comment-email")).not.toBeChecked();
  await expect(page.getByTestId("pref-version-inApp")).toBeChecked(); // unrelated cell unchanged
});
```
> The `resolve`×email checkbox must render even though it's disabled, so `pref-resolve-email` resolves and `toBeDisabled()` holds. (The component renders all cells; non-existent cells are `disabled`.)

- [ ] **Step 4: Typecheck + lint**

```bash
npx tsc --noEmit
pnpm lint
```
Expected: 0 / 0.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add components/NotificationSettings.tsx app/app/settings/notifications/page.tsx tests/e2e/notifications-pref.spec.ts
/usr/bin/git commit -m "feat(m6-p2): per-type notification settings matrix UI"
```

---

### Task 7: Drop legacy boolean columns + full verification

**Goal:** Now that nothing references `emailNotifications`/`desktopNotifications`, drop them, and prove the whole phase green end-to-end.

**Files:**
- Modify: `prisma/schema.prisma` (remove the two boolean fields)
- Create: `prisma/migrations/<timestamp>_drop_legacy_notification_booleans/migration.sql`

**Acceptance Criteria:**
- [ ] No source references to `emailNotifications` or `desktopNotifications` remain (grep clean, excluding the migration that backfilled from them and the `prisma/migrations` history).
- [ ] The two columns are dropped via a Prisma migration; client regenerated.
- [ ] Full gate green: `CI=true pnpm test:unit`, `pnpm test:e2e`, `pnpm lint`, `npx tsc --noEmit`, `pnpm build`.

**Verify:** all five commands green; `grep -rn "emailNotifications\|desktopNotifications" app components lib tests` returns nothing.

**Steps:**

- [ ] **Step 1: Confirm no remaining references** (each its own Bash call)

```bash
grep -rn "emailNotifications\|desktopNotifications" app components lib tests
```
Expected: no matches. If any remain, fix them before dropping the columns.

- [ ] **Step 2: Remove the fields from `prisma/schema.prisma`** — delete these two lines from `User`:

```prisma
  emailNotifications Boolean @default(true)
  desktopNotifications Boolean @default(false)
```

- [ ] **Step 3: Generate + apply the drop migration**

```bash
pnpm exec prisma migrate dev --name drop_legacy_notification_booleans
pnpm exec prisma generate
```
Expected: Prisma rebuilds the `User` table without the two columns (SQLite table-rebuild), preserving `notificationPrefs`; migration applies cleanly.

- [ ] **Step 4: Full verification suite** (each its own Bash call)

```bash
CI=true pnpm test:unit
pnpm lint
npx tsc --noEmit
pnpm build
lsof -ti tcp:3000 | xargs -r kill -9
pnpm test:e2e
```
Expected: unit all pass (incl. the new prefs/dispatch/settings tests); lint 0; tsc 0; build 0 errors; e2e all pass (incl. the rewritten `notifications-pref.spec.ts` and the migrated DB). If an e2e spec flakes, re-run that one spec once; report real failures.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add prisma/schema.prisma prisma/migrations
/usr/bin/git commit -m "feat(m6-p2): drop legacy notification booleans (migrated to notificationPrefs)"
```

- [ ] **Step 6: Finish** — leave the branch ready to fast-forward into local `main` (do NOT push, do NOT open a PR). Report the suites' results.
