# M4 · P5 — Generic Env Vars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-rename `BETTER_AUTH_URL`→`BASE_URL` and `BETTER_AUTH_SECRET`→`AUTH_SECRET`, wiring them into better-auth explicitly and DRYing base-URL reads behind a helper.

**Architecture:** Pass `secret`/`baseURL` explicitly into `betterAuth()` from the new env names (the library auto-reads the old names today, so the rename requires explicit wiring). A `baseUrl()` helper in `lib/config.ts` centralizes the four ad-hoc origin reads. Update all config/docs references; verify no `BETTER_AUTH_` remains.

**Tech Stack:** better-auth, Next.js, Vitest.

**Design spec:** `docs/superpowers/specs/2026-06-08-quorum-ai-m4-p5-generic-env-vars-design.md`

**Worktree/env notes:** isolated worktree off `main`; `CI=true` on script runs; `.env`+`data/`+`prisma migrate deploy` for the unit suite. **Set the new names in your worktree `.env`** (`BASE_URL`, `AUTH_SECRET`) or auth/tests that need them will break. Rebase onto `main`.

---

### Task 1: `baseUrl()` helper

**Goal:** A single source for the app's public origin, reading `BASE_URL` with a localhost fallback.

**Files:**
- Modify: `lib/config.ts` (add `baseUrl`; `isEditUiEnabled` already lives here)
- Test: `tests/unit/config.baseurl.test.ts`

**Acceptance Criteria:**
- [ ] `baseUrl({ BASE_URL: "https://q.example" })` → `"https://q.example"`.
- [ ] `baseUrl({})` → `"http://localhost:3000"`.
- [ ] Accepts an injectable env object.

**Verify:** `CI=true pnpm exec vitest run tests/unit/config.baseurl.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/config.baseurl.test.ts
import { describe, expect, test } from "vitest";
import { baseUrl } from "@/lib/config";

describe("baseUrl", () => {
  test("returns BASE_URL when set", () => {
    expect(baseUrl({ BASE_URL: "https://q.example" })).toBe("https://q.example");
  });
  test("falls back to localhost when unset", () => {
    expect(baseUrl({})).toBe("http://localhost:3000");
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `CI=true pnpm exec vitest run tests/unit/config.baseurl.test.ts` → FAIL (`baseUrl` not a function).

- [ ] **Step 3: Add `baseUrl` to `lib/config.ts`** (alongside `isEditUiEnabled`):

```ts
/** The app's public origin, e.g. https://quorum.example. Falls back to localhost in dev. */
export function baseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.BASE_URL ?? "http://localhost:3000";
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `CI=true pnpm exec vitest run tests/unit/config.baseurl.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/config.ts tests/unit/config.baseurl.test.ts
git commit -m "feat(m4-p5): baseUrl() config helper (BASE_URL)"
```

---

### Task 2: Wire new env names into better-auth + route callers through `baseUrl()`

**Goal:** `betterAuth()` uses `AUTH_SECRET`/`BASE_URL` explicitly; all app-origin reads go through `baseUrl()`.

**Files:**
- Modify: `lib/auth.ts` (explicit `secret`/`baseURL`; `trustedOrigins` from `BASE_URL`)
- Modify: `lib/email-templates.ts` (use `baseUrl()`)
- Modify: `app/api/plans/route.ts` (use `baseUrl()`)
- Modify: `app/app/settings/tokens/page.tsx` (use `baseUrl()`)
- Modify: `tests/unit/email-templates.test.ts` (stub `BASE_URL`)

**Acceptance Criteria:**
- [ ] `lib/auth.ts` passes `secret: process.env.AUTH_SECRET` and `baseURL: process.env.BASE_URL` to `betterAuth()`; `trustedOrigins` built from `BASE_URL` + `TRUSTED_ORIGINS`.
- [ ] `email-templates.ts`, `plans/route.ts`, `tokens/page.tsx` read the origin via `baseUrl()`.
- [ ] No `BETTER_AUTH_URL` reads remain in `app/` or `lib/`.
- [ ] `email-templates.test.ts` stubs `BASE_URL` and passes.

**Verify:** `CI=true pnpm exec vitest run tests/unit/email-templates.test.ts && CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint` → PASS/clean.

**Steps:**

- [ ] **Step 1: Update `lib/auth.ts`.** Replace the `BETTER_AUTH_URL` trustedOrigins read and add explicit `secret`/`baseURL` to the `betterAuth()` call:

```ts
const trustedOrigins = [
  process.env.BASE_URL,
  ...(process.env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
].filter(Boolean) as string[];

export const auth = betterAuth({
  // ...existing config (database, plugins, emailAndPassword, etc.)...
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.BASE_URL,
  trustedOrigins,
});
```

  Keep all other existing config keys unchanged; only add `secret`/`baseURL` and swap the trustedOrigins source. (Match the existing `trustedOrigins` construction style in the file.)

- [ ] **Step 2: Update the three origin callers to use `baseUrl()`.** Add `import { baseUrl } from "@/lib/config";` to each and replace the inline reads:
  - `lib/email-templates.ts:10` — the `baseUrl()` local/`process.env.BETTER_AUTH_URL ?? ""` helper → use the shared `baseUrl()` (consistent localhost fallback instead of `""`).
  - `app/api/plans/route.ts:15` — `const base = baseUrl();` (was `process.env.BETTER_AUTH_URL ?? "http://localhost:3000"`).
  - `app/app/settings/tokens/page.tsx` — the `baseUrl={process.env.BETTER_AUTH_URL ?? ""}` prop → `baseUrl={baseUrl()}`.

  Note: if `email-templates.ts` already defines a local function literally named `baseUrl`, remove it and import the shared one (avoid a name clash).

- [ ] **Step 3: Update `tests/unit/email-templates.test.ts`** — change the env stub from `BETTER_AUTH_URL` to `BASE_URL` (e.g. `vi.stubEnv("BASE_URL", "https://q.example")` or the existing assignment style; with `unstubEnvs:true` in vitest config, `vi.stubEnv` is preferred).

- [ ] **Step 4: Verify no stale reads.** Run: `grep -rn "BETTER_AUTH_URL" app lib` → expect **zero** hits. Then `CI=true pnpm exec vitest run tests/unit/email-templates.test.ts && CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint` → PASS/clean.

- [ ] **Step 5: Commit.**

```bash
git add lib/auth.ts lib/email-templates.ts app/api/plans/route.ts app/app/settings/tokens/page.tsx tests/unit/email-templates.test.ts
git commit -m "feat(m4-p5): use AUTH_SECRET/BASE_URL explicitly; route origin reads through baseUrl()"
```

---

### Task 3: Rename in deployment/config files + README + grep guard

**Goal:** All operator-facing config and docs use the new names; no `BETTER_AUTH_` token remains in tracked files.

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Acceptance Criteria:**
- [ ] `.env.example` declares `AUTH_SECRET` and `BASE_URL` (with updated comments) and no old names.
- [ ] `docker-compose.yml` passes `AUTH_SECRET`/`BASE_URL`.
- [ ] `.github/workflows/ci.yml` sets the new names (the env at the prior `BETTER_AUTH_*` lines).
- [ ] README quickstart/container/deploy sections use the new names and note the breaking rename.
- [ ] `grep -rn "BETTER_AUTH_" . --exclude-dir=node_modules --exclude-dir=.git` returns **zero** hits in tracked files.

**Verify:** `grep -rn "BETTER_AUTH_" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next` → no output; full suite `CI=true pnpm exec vitest run` → PASS.

**Steps:**

- [ ] **Step 1: `.env.example`.** Rename the two lines + comment:

```
# better-auth / app
AUTH_SECRET="change-me-to-a-32+char-random-string"
BASE_URL="http://localhost:3000"
# Extra CSRF-trusted origins beyond BASE_URL (comma-separated).
TRUSTED_ORIGINS=
```

- [ ] **Step 2: `docker-compose.yml`.** Change the env keys passed to the `app` service from `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` to `AUTH_SECRET`/`BASE_URL` (update both the key names and any `${...}` interpolation).

- [ ] **Step 3: `.github/workflows/ci.yml`.** At the two env spots (around lines 17 and 38), rename `BETTER_AUTH_SECRET`→`AUTH_SECRET` (and `BETTER_AUTH_URL`→`BASE_URL` if present).

- [ ] **Step 4: `README.md`.** Replace every `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` mention (quickstart `.env` setup, `docker compose up` example, deploy docs) with the new names. Add a short note under M4/upgrade: "**Breaking (M4):** `BETTER_AUTH_SECRET`→`AUTH_SECRET`, `BETTER_AUTH_URL`→`BASE_URL`. Update your env before upgrading."

- [ ] **Step 5: Verify the guard.** Run: `grep -rn "BETTER_AUTH_" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next` → no output. Run the full suite: `CI=true pnpm exec vitest run` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add .env.example docker-compose.yml .github/workflows/ci.yml README.md
git commit -m "feat(m4-p5): rename BETTER_AUTH_* env to AUTH_SECRET/BASE_URL across config + docs"
```

---

## Self-Review

- **Spec coverage:** `baseUrl()` helper → Task 1; explicit better-auth wiring + caller DRY + email-templates test → Task 2; config/docs rename + grep guard → Task 3. All spec "Files touched" covered.
- **Type/name consistency:** `baseUrl(env?)` defined in Task 1, imported in Task 2; new env names `AUTH_SECRET`/`BASE_URL` consistent across auth wiring (T2) and config/docs (T3).
- **Placeholders:** none — full code/edits per step; the grep guard is a concrete verification command.

**Dependencies:** Task 2 blockedBy Task 1; Task 3 blockedBy Task 2 (the `app/lib` rename must land before the repo-wide `BETTER_AUTH_` guard can pass).
