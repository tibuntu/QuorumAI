# M4 · P2 — Edit-UI Feature Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an env flag `EDIT_UI_ENABLED` (default ON) that hides the in-app document Edit button when off, leaving the edit API untouched.

**Architecture:** A server-read config helper (`lib/config.ts`) returns a boolean; the document server page passes it as an `editEnabled` prop (like `isOwner`) into `DocumentView`, which gates the Edit button. Not `NEXT_PUBLIC_` — stays out of the client bundle.

**Tech Stack:** Next.js App Router (server component reads `process.env`), Vitest, React client component.

**Design spec:** `docs/superpowers/specs/2026-06-08-quorum-ai-m4-p2-edit-ui-flag-design.md`

**Worktree/env notes:** isolated worktree off `main`; `CI=true` on script runs; `.env`+`data/`+`prisma migrate deploy` for the unit suite; preserve `data-testid`/button-name hooks; rebase onto `main`.

---

### Task 1: `isEditUiEnabled` config helper

**Goal:** A testable helper that defaults to enabled and is disabled only by `EDIT_UI_ENABLED=false` (case-insensitive).

**Files:**
- Create: `lib/config.ts`
- Test: `tests/unit/config.edit-ui.test.ts`

**Acceptance Criteria:**
- [ ] Unset → `true`; `"false"`/`"FALSE"` → `false`; `"true"` / any other value → `true`.
- [ ] Accepts an injectable env object (no mutation of `process.env` in tests).

**Verify:** `CI=true pnpm exec vitest run tests/unit/config.edit-ui.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/config.edit-ui.test.ts
import { describe, expect, test } from "vitest";
import { isEditUiEnabled } from "@/lib/config";

describe("isEditUiEnabled", () => {
  test("defaults to enabled when unset", () => {
    expect(isEditUiEnabled({})).toBe(true);
  });
  test("disabled only by 'false' (case-insensitive)", () => {
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "false" })).toBe(false);
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "FALSE" })).toBe(false);
  });
  test("enabled for 'true' or any other value", () => {
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "true" })).toBe(true);
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "1" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `CI=true pnpm exec vitest run tests/unit/config.edit-ui.test.ts` → FAIL (`isEditUiEnabled` not a function).

- [ ] **Step 3: Implement `lib/config.ts`** (mirror `isOidcConfigured`'s injectable-env signature in `lib/oidc.ts`):

```ts
/** Whether the in-app document editing UI is shown. Default ON;
 *  operators opt out with EDIT_UI_ENABLED=false. UI-only — the edit API is not gated. */
export function isEditUiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EDIT_UI_ENABLED?.toLowerCase() !== "false";
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `CI=true pnpm exec vitest run tests/unit/config.edit-ui.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/config.ts tests/unit/config.edit-ui.test.ts
git commit -m "feat(m4-p2): isEditUiEnabled config helper (default on)"
```

---

### Task 2: Wire `editEnabled` prop and gate the Edit button + docs

**Goal:** The document page passes `editEnabled` into `DocumentView`, which hides the Edit button when false; the var is documented.

**Files:**
- Modify: `app/app/documents/[id]/page.tsx` (compute + pass `editEnabled`)
- Modify: `components/DocumentView.tsx` (accept prop; gate Edit button)
- Modify: `.env.example` (document the var)
- Modify: `README.md` (one line in env/config section)

**Acceptance Criteria:**
- [ ] With `EDIT_UI_ENABLED=false`, the Edit button is absent for an owner; default/unset shows it.
- [ ] No other path reaches edit mode when the flag is off (Edit button is the only `setMode("edit")` trigger).
- [ ] `.env.example` + README document the var as UI-only, default on.
- [ ] `tsc` + lint clean; existing test selectors unchanged.

**Verify:** `CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint` clean. Manual: set `EDIT_UI_ENABLED=false` in `.env`, restart `pnpm dev`, open a doc as owner → no Edit button; unset → Edit button returns.

**Steps:**

- [ ] **Step 1: Server page.** In `app/app/documents/[id]/page.tsx`, import and compute the flag near the `isOwner` computation (~line 37), then pass it:

```tsx
import { isEditUiEnabled } from "@/lib/config";
// ...
const isOwner = doc.ownerId === session.user.id;
const editEnabled = isEditUiEnabled();
// ...
return <DocumentView doc={serializable} isOwner={isOwner} editEnabled={editEnabled} />;
```

- [ ] **Step 2: DocumentView props.** Extend the component signature (line 64) and gate the Edit button (line ~337):

```tsx
export default function DocumentView({ doc, isOwner, editEnabled }: { doc: ClientDocument; isOwner: boolean; editEnabled: boolean }) {
```

```tsx
{mode === "review" && editEnabled && (
  <Button variant="secondary" size="sm" onClick={() => { setDraft(markdown); setMode("edit"); }}>Edit</Button>
)}
```

  Search the file for any other `setMode("edit")` call; if one exists outside this button, gate it too. (Per the design spec the button is the only entry point.)

- [ ] **Step 3: Confirm no other caller of `DocumentView` breaks.** Search for `<DocumentView` usages: `grep -rn "DocumentView" app components`. The document page is the only render site; if a test or story renders it, add `editEnabled` there too.

- [ ] **Step 4: Document the var in `.env.example`** (after the OIDC block):

```
# Document editing UI (optional). Default: enabled.
# Set to "false" to hide the in-app Edit button (plans stay agent-driven via the API).
# The PATCH /api/documents/[id] edit endpoint is NOT gated — only the UI.
EDIT_UI_ENABLED=
```

- [ ] **Step 5: README.** Add one line to the env/config section: ``EDIT_UI_ENABLED` (default on) — set to `false` to hide the in-app document Edit button; the edit API is unaffected.`

- [ ] **Step 6: Verify + manual check.** Run: `CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint` → clean. Manual toggle as in **Verify**.

- [ ] **Step 7: Commit.**

```bash
git add app/app/documents/[id]/page.tsx components/DocumentView.tsx .env.example README.md
git commit -m "feat(m4-p2): gate in-app Edit button behind EDIT_UI_ENABLED (UI-only, default on)"
```

---

## Self-Review

- **Spec coverage:** helper + tests → Task 1; prop wiring + button gate + `.env.example`/README → Task 2. PATCH route intentionally untouched (spec: UI-only).
- **Type/name consistency:** `isEditUiEnabled(env?)` defined in Task 1, imported in Task 2; `editEnabled` prop name consistent across page and component.
- **Placeholders:** none — full code per step; the README line is given verbatim.

**Dependencies:** Task 2 blockedBy Task 1.
