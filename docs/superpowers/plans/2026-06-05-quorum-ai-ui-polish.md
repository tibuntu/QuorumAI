# Quorum AI — UI Polish Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers SHOULD also use the `frontend-design` skill for component craft.

**Goal:** Apply a cohesive "Violet consensus" product-grade design across the whole app — design tokens (light + system dark), a branded top-nav, reusable UI primitives, typeset markdown, and a public landing page — without changing behavior or breaking existing test selectors.

**Architecture:** Presentation-only. Centralize the design system in `app/globals.css` (Tailwind v4 CSS-variable tokens + `@tailwindcss/typography`) and `components/ui/` primitives, then refactor each screen onto them. No backend/API/state changes.

**Tech Stack:** Next.js 16, Tailwind CSS v4, `@tailwindcss/typography` (new), React 19. Tests: Vitest + Playwright.

**CRITICAL — preserve test contracts.** The redesign must keep every selector the suites use. Before editing any component, `grep` the test files for it; after editing, re-run the suites. These MUST survive verbatim:
- **data-testid:** `current-user`, `doc-body`, `doc-state`, `thread`, `orphaned-section`, `editor`, `new-token`, `notification`, `inbox-link`
- **aria-label:** `title`, `markdown`, `comment`, `reply`, `editor`, `token label`, `name`, `email`, `password`
- **button accessible names:** `Sign up`, `Sign out`, `Log in`, `Create document`, `Comment`, `Approve`, `Request changes`, `Edit`, `Save`, `Cancel`, `Create token`, `Reply`, `Resolve`/`Reopen`, `Mark all read`
- **`doc-state` exact text:** `Open`, `Changes requested`, `Approved`

**Conventions:** Plain commits, **no AI attribution trailer**. SCM Breeze → use Write/Edit, single-line Bash, `command git`. **This worktree runs pnpm v11: prefix every pnpm script run with `CI=true`** (avoids the no-TTY modules-purge abort). **Free port 3000 before e2e:** `lsof -ti tcp:3000 | xargs -r kill -9`. Branch `ui-polish`.

---

### Task 1: Design tokens + typography plugin

**Goal:** Replace the starter `globals.css` with a violet/slate token system (light + system dark) and register `@tailwindcss/typography`.

**Files:**
- Modify: `app/globals.css`
- Modify: `package.json` / `pnpm-lock.yaml` (add `@tailwindcss/typography`)

**Acceptance Criteria:**
- [ ] `@tailwindcss/typography` installed and registered via `@plugin`
- [ ] CSS variables define color/surface/border/fg/muted/primary + semantic state colors, with a `prefers-color-scheme: dark` override
- [ ] Tokens exposed to Tailwind utilities via `@theme inline` (e.g. `bg-surface`, `text-muted`, `bg-primary`, `border-border`)
- [ ] `CI=true pnpm build` passes; `CI=true pnpm test:unit` still 30 passed

**Verify:** `CI=true pnpm build` → passes; `CI=true pnpm test:unit` → 30 passed.

**Steps:**

- [ ] **Step 1: Add the dependency.** Run: `CI=true pnpm add -D @tailwindcss/typography`

- [ ] **Step 2: Rewrite** `app/globals.css`:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";

:root {
  --background: #faf9fc;
  --surface: #ffffff;
  --border: #e7e5ef;
  --foreground: #1e1b2e;
  --muted: #6b6780;
  --primary: #6d28d9;
  --primary-hover: #5b21b6;
  --primary-fg: #ffffff;
  --primary-subtle: #ede9fe;
  --state-open: #b45309;
  --state-open-bg: #fef3c7;
  --state-changes: #b91c1c;
  --state-changes-bg: #fee2e2;
  --state-approved: #15803d;
  --state-approved-bg: #dcfce7;
  --state-neutral: #475569;
  --state-neutral-bg: #f1f5f9;
  --radius: 0.625rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0e0c15;
    --surface: #17141f;
    --border: #2a2536;
    --foreground: #ece9f5;
    --muted: #a09bb3;
    --primary: #a78bfa;
    --primary-hover: #c4b5fd;
    --primary-fg: #1e1b2e;
    --primary-subtle: #2a2440;
    --state-open: #fcd34d;
    --state-open-bg: #3a2e0a;
    --state-changes: #fca5a5;
    --state-changes-bg: #3a1414;
    --state-approved: #86efac;
    --state-approved-bg: #0f2e1a;
    --state-neutral: #cbd5e1;
    --state-neutral-bg: #1e293b;
  }
}

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-border: var(--border);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-hover);
  --color-primary-fg: var(--primary-fg);
  --color-primary-subtle: var(--primary-subtle);
  --radius-app: var(--radius);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-geist-sans), system-ui, sans-serif;
}
```

- [ ] **Step 3: Verify.** `CI=true pnpm build` → passes; `CI=true pnpm test:unit` → 30 passed.

- [ ] **Step 4: Commit.**
```bash
command git add app/globals.css package.json pnpm-lock.yaml
command git commit -m "feat: add design tokens and typography plugin"
```

---

### Task 2: UI primitives (`components/ui/`)

**Goal:** Token-driven, reusable `Button`, `Input`, `Textarea`, `Card`, `Badge` components that forward all props (so `aria-label`/children survive).

**Files:**
- Create: `components/ui/Button.tsx`, `components/ui/Input.tsx`, `components/ui/Textarea.tsx`, `components/ui/Card.tsx`, `components/ui/Badge.tsx`

**Acceptance Criteria:**
- [ ] `Button` supports `variant` (`primary`/`secondary`/`ghost`/`danger`) + `size`, forwards `...props` and `children`, renders a `<button>`
- [ ] `Input`/`Textarea` forward all props (incl. `aria-label`) with token styling + focus ring
- [ ] `Card` is a surface container; `Badge` maps a `tone` to semantic state colors and renders its children verbatim
- [ ] `CI=true pnpm build` passes

**Verify:** `CI=true pnpm build` → passes.

**Steps:**

- [ ] **Step 1:** `components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover",
  secondary: "border border-border bg-surface text-foreground hover:bg-primary-subtle",
  ghost: "text-foreground hover:bg-primary-subtle",
  danger: "bg-[var(--state-changes)] text-white hover:opacity-90",
};
const SIZES: Record<Size, string> = { sm: "px-2.5 py-1 text-sm", md: "px-3.5 py-2 text-sm" };

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-app)] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 2:** `components/ui/Input.tsx` and `components/ui/Textarea.tsx`:

```tsx
import type { InputHTMLAttributes } from "react";
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-[var(--radius-app)] border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/30 ${className}`}
      {...props}
    />
  );
}
```

```tsx
import type { TextareaHTMLAttributes } from "react";
export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-[var(--radius-app)] border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/30 ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 3:** `components/ui/Card.tsx`:

```tsx
import type { HTMLAttributes } from "react";
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[var(--radius-app)] border border-border bg-surface ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 4:** `components/ui/Badge.tsx` (tone → state color; `stateTone` maps a DocumentState string):

```tsx
import type { HTMLAttributes } from "react";

export type Tone = "open" | "changes" | "approved" | "neutral";

const TONES: Record<Tone, string> = {
  open: "text-[var(--state-open)] bg-[var(--state-open-bg)]",
  changes: "text-[var(--state-changes)] bg-[var(--state-changes-bg)]",
  approved: "text-[var(--state-approved)] bg-[var(--state-approved-bg)]",
  neutral: "text-[var(--state-neutral)] bg-[var(--state-neutral-bg)]",
};

export function stateTone(state: string): Tone {
  if (state === "OPEN") return "open";
  if (state === "CHANGES_REQUESTED") return "changes";
  if (state === "APPROVED") return "approved";
  return "neutral";
}

export function Badge({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 5:** `CI=true pnpm build` → passes. Commit:
```bash
command git add components/ui
command git commit -m "feat: add token-driven UI primitives"
```

---

### Task 3: App shell / branded top-nav

**Goal:** Replace the minimal header with a branded nav exposing Documents / Inbox (badge) / Settings, making the tokens + inbox pages reachable.

**Files:**
- Create: `components/AppNav.tsx`
- Modify: `app/app/layout.tsx`

**Acceptance Criteria:**
- [ ] Header shows wordmark, links **Documents** (`/app`), **Inbox** (`/app/inbox`), **Settings** (`/app/settings/tokens`), the user email (`data-testid="current-user"`), and Sign out
- [ ] The Inbox link keeps `data-testid="inbox-link"` and shows the unread count when > 0
- [ ] Layout still redirects to `/login` when unauthenticated and passes `unread` from the existing `unreadCount` query
- [ ] `CI=true pnpm build` passes; the existing auth e2e still passes (`current-user` resolves)

**Verify:** `CI=true pnpm build` → passes; `lsof -ti tcp:3000 | xargs -r kill -9; CI=true pnpm test:e2e -- tests/e2e/auth.spec.ts` → passes.

**Steps:**

- [ ] **Step 1:** `components/AppNav.tsx` (client for active-link styling via `usePathname`):

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";

const LINKS = [
  { href: "/app", label: "Documents", testid: undefined as string | undefined },
  { href: "/app/inbox", label: "Inbox", testid: "inbox-link" },
  { href: "/app/settings/tokens", label: "Settings", testid: undefined },
];

export function AppNav({ email, unread }: { email: string; unread: number }) {
  const pathname = usePathname();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/app" className="font-semibold text-foreground">◆ Quorum</Link>
          <nav className="flex items-center gap-1 text-sm">
            {LINKS.map((l) => {
              const active = l.href === "/app" ? pathname === "/app" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  data-testid={l.testid}
                  className={`rounded-md px-2.5 py-1.5 ${active ? "bg-primary-subtle text-primary" : "text-muted hover:text-foreground"}`}
                >
                  {l.label}
                  {l.href === "/app/inbox" && unread > 0 && (
                    <span className="ml-1.5 rounded-full bg-[var(--state-changes)] px-1.5 text-xs text-white">{unread}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span data-testid="current-user" className="text-muted">{email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2:** Refactor `app/app/layout.tsx` to use it (keep the redirect + the existing `unreadCount` import added in Part 3):

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { unreadCount } from "@/lib/notifications";
import { AppNav } from "@/components/AppNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const unread = await unreadCount(session.user.id);

  return (
    <div className="min-h-screen bg-background">
      <AppNav email={session.user.email} unread={unread} />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
```

> If the existing layout already computed `unread` for a header badge (Part 3), reuse that; do not add a second query.

- [ ] **Step 3:** Verify build + auth e2e (commands above).

- [ ] **Step 4:** Commit:
```bash
command git add components/AppNav.tsx app/app/layout.tsx
command git commit -m "feat: add branded app navigation shell"
```

---

### Task 4: Documents list + New-document form polish

**Goal:** Restyle `/app` as a responsive card grid with state badges and a polished create form + empty state.

**Files:**
- Modify: `app/app/page.tsx`, `components/NewDocumentForm.tsx`

**Acceptance Criteria:**
- [ ] Documents render as `Card`s in a responsive grid with title, owner, and a state `Badge` (via `stateTone`), each linking to `/app/documents/:id`
- [ ] Empty state styled when there are no documents
- [ ] `NewDocumentForm` uses `Input`/`Textarea`/`Button`; keeps `aria-label="title"`, `aria-label="markdown"`, and the `Create document` button name
- [ ] `CI=true pnpm build` passes

**Verify:** `CI=true pnpm build` → passes. (Create flow re-checked by the integration e2e in Task 8.)

**Steps:**

- [ ] **Step 1:** Restyle `app/app/page.tsx` — keep `listDocuments()` server fetch and the `STATE_LABELS` map. Render a heading, then either an empty-state `Card` ("No documents yet — create one below.") or a `grid gap-4 sm:grid-cols-2` of `Card`s. Each card: `<Link href={\`/app/documents/${doc.id}\`}>` with title (`font-medium`), owner name/email (`text-muted text-sm`), and `<Badge tone={stateTone(doc.state)}>{STATE_LABELS[doc.state] ?? doc.state}</Badge>`. Render `<NewDocumentForm />` below in a `Card` with padding. Import `Card`, `Badge`, `stateTone` from `@/components/ui/...`.

- [ ] **Step 2:** Restyle `components/NewDocumentForm.tsx` — replace raw `<input>/<textarea>/<button>` with `Input`/`Textarea`/`Button`. PRESERVE: `aria-label="title"` on the title input, `aria-label="markdown"` on the textarea, the submit button text `Create document`, the `POST /api/documents` logic, and `router.push` on 201. Keep the inline error `<p role="alert">`.

- [ ] **Step 3:** `CI=true pnpm build` → passes. Commit:
```bash
command git add app/app/page.tsx components/NewDocumentForm.tsx
command git commit -m "feat: polish documents list and create form"
```

---

### Task 5: Document view + sidebar + editor polish (markdown typography)

**Goal:** Apply themed `prose` typography to rendered markdown and restyle the review bar, comment composer, sidebar threads, and editor — preserving all interaction hooks.

**Files:**
- Modify: `components/DocumentView.tsx`, `components/CommentSidebar.tsx`, `components/DocumentEditor.tsx`

**Acceptance Criteria:**
- [ ] The rendered-markdown container (`data-testid="doc-body"`) and the editor preview pane carry `prose` styling that follows the palette (readable in light + dark)
- [ ] Review bar uses `Button` (`Approve` primary, `Request changes` danger); `data-testid="doc-state"` still shows exact `Open`/`Changes requested`/`Approved`
- [ ] Comment composer keeps `aria-label="comment"` + `Comment` button; sidebar threads keep `data-testid="thread"`, `aria-label="reply"`, `Reply`, `Resolve`/`Reopen`, and `data-testid="orphaned-section"`; editor keeps `data-testid="editor"`, `aria-label="editor"`, `Save`/`Cancel`; `mark[data-annotation-id]`/`data-status` highlight markup unchanged
- [ ] `CI=true pnpm build` passes; review + versioning e2e pass

**Verify:** `CI=true pnpm build` → passes; `lsof -ti tcp:3000 | xargs -r kill -9; CI=true pnpm test:e2e -- tests/e2e/review.spec.ts tests/e2e/versioning.spec.ts` → all pass.

**Steps:**

- [ ] **Step 1:** In `components/DocumentView.tsx`, give the `data-testid="doc-body"` container `className="prose prose-violet max-w-none ..."` wrapping the `RenderedMarkdown`. Do NOT change `containerRef`, the selection logic, the highlight effect, or any testid. Restyle the surrounding two-column layout with token utilities (`bg-surface`, `border-border`). Replace the Approve/Request-changes/Edit raw buttons with `Button` (`variant="primary"` / `variant="danger"` / `variant="secondary"`) keeping their exact text. Keep `data-testid="doc-state"` and its label map exactly.

- [ ] **Step 2:** In `components/CommentSidebar.tsx`, wrap each thread in a `Card` (keep `data-testid="thread"`), restyle comments/quote snippet, replace the reply `<textarea>` with `Textarea` (keep `aria-label="reply"`) and reply/resolve buttons with `Button` (keep `Reply`, `Resolve`/`Reopen`). Keep the `data-testid="orphaned-section"` block and the `moved` indicator.

- [ ] **Step 3:** In `components/DocumentEditor.tsx`, wrap the preview pane in `prose prose-violet max-w-none`, restyle the Save/Cancel buttons with `Button` (keep names), and keep `data-testid="editor"` + `aria-label="editor"` on the CodeMirror container exactly.

- [ ] **Step 4:** Run build + the two e2e specs (commands above). If any selector-based assertion fails, restore the exact attribute — do not weaken the test.

- [ ] **Step 5:** Commit:
```bash
command git add components/DocumentView.tsx components/CommentSidebar.tsx components/DocumentEditor.tsx
command git commit -m "feat: polish document review view with markdown typography"
```

---

### Task 6: Inbox + Settings/tokens polish

**Goal:** Restyle the inbox list and the token-management page using the primitives, preserving their hooks.

**Files:**
- Modify: `components/InboxList.tsx`, `app/app/inbox/page.tsx`, `components/TokenManager.tsx`, `app/app/settings/tokens/page.tsx`

**Acceptance Criteria:**
- [ ] Inbox rows are `Card`s (keep `data-testid="notification"` + deep links), unread emphasized, with the `Mark all read` button
- [ ] Token page: `Card`-framed list + create form keeping `aria-label="token label"`, the `Create token` button, the `data-testid="new-token"` reveal field, and revoke buttons; setup snippet in a styled `<pre>`
- [ ] `CI=true pnpm build` passes

**Verify:** `CI=true pnpm build` → passes. (Inbox + token flows re-checked by the integration e2e in Task 8.)

**Steps:**

- [ ] **Step 1:** Restyle `components/InboxList.tsx` — each row a `Card` (keep `data-testid="notification"` + the `<Link>` deep link + optimistic mark-read), unread rows get a `border-l-2 border-primary`/bolder treatment; `Mark all read` via `Button variant="secondary"`. Keep the type-label map.

- [ ] **Step 2:** Lightly restyle `app/app/inbox/page.tsx` (heading + spacing); no behavior change.

- [ ] **Step 3:** Restyle `components/TokenManager.tsx` — `Card` for the list and the create form; `Input` (keep `aria-label="token label"`), `Button` `Create token`; the one-time token reveal keeps `data-testid="new-token"` (a readonly `Input` or styled box); revoke via `Button variant="ghost"`/`danger`; setup snippet in a `<pre className="...bg-[var(--state-neutral-bg)]...">`.

- [ ] **Step 4:** Lightly restyle `app/app/settings/tokens/page.tsx` (heading/layout). 

- [ ] **Step 5:** `CI=true pnpm build` → passes. Commit:
```bash
command git add components/InboxList.tsx app/app/inbox/page.tsx components/TokenManager.tsx app/app/settings/tokens/page.tsx
command git commit -m "feat: polish inbox and settings token UI"
```

---

### Task 7: Auth pages + public landing page

**Goal:** Brand the login/register pages and add a real public landing page at `/`.

**Files:**
- Modify: `app/login/page.tsx`, `app/register/page.tsx`, `app/page.tsx`

**Acceptance Criteria:**
- [ ] Login/register are centered branded `Card`s using `Input`/`Button`; keep `aria-label`s (`name`/`email`/`password`), the `Sign up`/`Log in` button names, and the existing submit/redirect logic
- [ ] `/` renders a public marketing hero (wordmark, one-liner, value blurb, CTAs to `/register` and `/login`) for logged-out visitors, and redirects authenticated users to `/app`
- [ ] `CI=true pnpm build` passes; auth e2e passes

**Verify:** `CI=true pnpm build` → passes; `lsof -ti tcp:3000 | xargs -r kill -9; CI=true pnpm test:e2e -- tests/e2e/auth.spec.ts` → passes.

**Steps:**

- [ ] **Step 1:** Restyle `app/login/page.tsx` and `app/register/page.tsx` — wrap the form in a centered `Card` (`mx-auto mt-24 max-w-sm p-6`), replace raw inputs/buttons with `Input`/`Button`. PRESERVE every `aria-label` (`name`, `email`, `password`), the button names (`Sign up`, `Log in`), the `signUp`/`signIn` calls, the `role="alert"` error, and the `router.push("/app")` redirects.

- [ ] **Step 2:** Replace `app/page.tsx` with a public landing that no longer blanket-redirects logged-out users to `/login`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";

export default async function Index() {
  const session = await getSession();
  if (session) redirect("/app");
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="text-sm font-semibold text-primary">◆ Quorum AI</span>
      <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
        Pull-request review, but for the plan — before the agent builds.
      </h1>
      <p className="max-w-xl text-lg text-muted">
        Your agent drafts a plan; your team reviews and refines it asynchronously; consolidated
        feedback flows back into the agent before a line of code is written.
      </p>
      <div className="flex gap-3">
        <Link href="/register"><Button>Get started</Button></Link>
        <Link href="/login"><Button variant="secondary">Log in</Button></Link>
      </div>
    </main>
  );
}
```

> Behavior change: logged-out visitors to `/` now see this page instead of an immediate redirect to `/login`. Existing e2e (`/app`→`/login`, direct `/register`) is unaffected.

- [ ] **Step 3:** Verify build + auth e2e (commands above).

- [ ] **Step 4:** Commit:
```bash
command git add app/login/page.tsx app/register/page.tsx app/page.tsx
command git commit -m "feat: brand auth pages and add public landing page"
```

---

### Task 8: Navigation e2e + full-suite verification

**Goal:** Add a regression test that the nav makes Settings/Inbox reachable, and confirm the entire suite + build are green after the redesign.

**Files:**
- Create: `tests/e2e/navigation.spec.ts`

**Acceptance Criteria:**
- [ ] After register, the header exposes Documents/Inbox/Settings; clicking **Settings** lands on `/app/settings/tokens` (token UI visible); clicking **Inbox** lands on `/app/inbox`
- [ ] Full unit suite (30) + ALL e2e specs (auth, review, versioning, integration, navigation) pass; `CI=true pnpm build` clean

**Verify:** `lsof -ti tcp:3000 | xargs -r kill -9; CI=true pnpm test:e2e` → all pass; `CI=true pnpm test:unit` → 30 passed; `CI=true pnpm build` → passes.

**Steps:**

- [ ] **Step 1:** Write `tests/e2e/navigation.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("nav reaches settings and inbox", async ({ page }) => {
  const email = `nav-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Nav User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/app\/settings\/tokens/);
  await expect(page.getByLabel("token label")).toBeVisible();

  await page.getByRole("link", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByTestId("inbox-link").click();
  await expect(page).toHaveURL(/\/app\/inbox/);
});

test("landing page shows for logged-out visitors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
});
```

- [ ] **Step 2:** Run the full e2e suite, unit suite, and build (commands above). Fix any selector regressions by restoring the exact attribute (never weaken assertions).

- [ ] **Step 3:** Commit:
```bash
command git add tests/e2e/navigation.spec.ts
command git commit -m "feat: add navigation reachability e2e"
```

---

## Self-review
- **Spec coverage:** tokens+dark ✓(T1); typography plugin ✓(T1,T5); primitives ✓(T2); branded nav + reachable Settings/Inbox ✓(T3); documents list ✓(T4); document view + markdown prose ✓(T5); inbox+settings ✓(T6); auth + landing ✓(T7); preserve-selectors constraint embedded in every screen task + a reachability e2e ✓(T8). Out-of-scope items (features/API/teams/email/version-browsing) untouched.
- **Placeholders:** none — tokens + primitives are complete code; screen tasks are restyle contracts that enumerate the exact preserved selectors/names and the verify commands. The landing page is complete code.
- **Type/name consistency:** `Button`/`Input`/`Textarea`/`Card`/`Badge`/`stateTone`/`Tone` (T2) consumed by T3–T7; `AppNav({email, unread})` (T3) matches the layout's `session.user.email` + `unreadCount`; preserved testids/aria-labels/button-names identical to the grep of the current code and to what the e2e specs query; `CI=true` + port-3000-free conventions applied to every verify command.

## Notes for later
- A manual or `gsd-ui-review` visual audit pass once merged.
- Optional: a user-toggleable dark mode (this phase follows the OS setting only).
- Deeper marketing landing page (this is a single hero screen).
