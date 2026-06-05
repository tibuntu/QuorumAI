# Quorum AI — UI Polish Phase (Design)

> **Status:** Approved design. Next step: `writing-plans` → implementation plan.
> **Builds on:** M1 Review Core (Parts 1–3, all merged). This phase adds no new product capability — it gives the existing app a cohesive, production-grade visual layer.

## Goal

Give Quorum AI a coherent **"Violet consensus"** product-grade design across every screen: a real design-token system (light + system dark), a branded navigation shell that makes Inbox and Settings reachable, reusable UI primitives, properly typeset rendered markdown, and a redesigned public landing page — without changing behavior or breaking the existing test selectors.

## Scope

**In scope:**
1. **Design tokens & theming** — token layer in `app/globals.css` (color/space/radius/type), light + system dark.
2. **App shell / top-nav** — branded header with Documents / Inbox (unread badge) / Settings nav.
3. **UI primitives** — `components/ui/` (Button, Input, Textarea, Card, Badge); refactor existing components onto them.
4. **Screen polish** — documents list, document view (incl. markdown typography), inbox, settings→tokens, login, register.
5. **Public landing page** — redesign `/` (hero + value prop + CTA). One screen, not a deep marketing effort.
6. **`@tailwindcss/typography`** for rendered markdown, themed to the palette.

**Out of scope:**
- Any new product feature or backend/API change (this is presentation-only).
- Historical-version browsing/diff UI (still deferred).
- Email notifications, teams (deferred from Part 3).
- A separate component-library/storybook or deep marketing site.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Direction | **B · Product-grade** — branded top-nav, card layouts, token system, polished components; single container app (no sidebar). |
| Personality | **A · Violet "consensus"** — indigo/violet primary on slate neutrals, system sans, soft rounded cards. |
| Dark mode | **Light + system dark** via `prefers-color-scheme` and CSS-variable tokens. |
| Markdown CSS | **`@tailwindcss/typography`** (`prose`), themed to the violet palette. |
| Landing page | **In scope** — redesign the public `/` route. |
| Craft | Implementation uses the **`frontend-design`** skill to avoid generic AI aesthetics. |

## Hard constraint — preserve test contracts

The redesign restyles and may restructure markup, but MUST keep every selector the existing Vitest/Playwright suites depend on. Implementers must `grep` the test files before editing a component and re-run the suites after. Known hooks that MUST survive:

- **data-testid:** `current-user`, `doc-body`, `doc-state`, `thread`, `orphaned-section`, `editor`, `new-token`, `notification`, `inbox-link`
- **aria-label:** `title`, `markdown`, `comment`, `reply`, `editor`, `token label`, `name`, `email`, `password`
- **Accessible button names** used by `getByRole("button", { name })`: `Sign up`, `Sign out`, `Create document`, `Comment`, `Approve`, `Request changes`, `Edit`, `Save`, `Create token`, `Reply`, `Resolve`/`Reopen`, `Mark all read`
- **State badge text:** `Open`, `Changes requested`, `Approved` (exact, in `doc-state`)

A change that renames or removes any of these is a regression even if it "looks done."

## Architecture

Presentation-only, layered so the design system is centralized rather than smeared across components.

### Design tokens — `app/globals.css`
Replace the starter file with a token layer using CSS variables under `:root` and a `@media (prefers-color-scheme: dark)` override, exposed to Tailwind v4 via `@theme inline`:
- **Color:** `--color-primary` (violet 700) + hover/subtle variants; `--color-bg`, `--color-surface`, `--color-border`, `--color-fg`, `--color-muted` (slate scale, flipped for dark); semantic `--color-open` (amber), `--color-changes` (red), `--color-approved` (green), `--color-neutral` (slate).
- **Radius/space/type:** `--radius` (e.g. 0.5rem), font stack (system sans; mono for code), a heading weight/size rhythm.
- Body uses the token bg/fg (replaces the hardcoded `Arial` + raw hex). Keep `--font-geist-*` wiring already present in `app/layout.tsx`.

### UI primitives — `components/ui/`
Small, focused, token-driven, each its own file:
- `Button.tsx` — variants `primary` | `secondary` | `ghost` | `danger`, `size` sm/md, disabled state. Renders a real `<button>`; forwards `children` (so accessible names are preserved) and props.
- `Input.tsx`, `Textarea.tsx` — token border/focus ring; forward `aria-label` and all props.
- `Card.tsx` — surface + border + radius + padding container.
- `Badge.tsx` — `tone` prop mapping document state → semantic color; renders provided text verbatim (so `doc-state` text stays exact).
Existing components (`NewDocumentForm`, `DocumentView`, `CommentSidebar`, `DocumentEditor`, `InboxList`, `TokenManager`, `SignOutButton`) refactor to use these — preserving all testids/labels/names.

### App shell — `app/app/layout.tsx` + `components/AppNav.tsx`
- New `AppNav` (server-friendly; the layout already fetches `session` + `unreadCount`): wordmark "◆ Quorum" linking `/app`; nav links **Documents** (`/app`), **Inbox** (`/app/inbox`, with the existing `data-testid="inbox-link"` and unread count badge), **Settings** (`/app/settings/tokens`); right side `data-testid="current-user"` + `SignOutButton`. Responsive: collapses to a simple row on small screens (no hamburger needed for M1).
- The layout passes `unread` into the nav (keeps the single `unreadCount` query).

### Screens
- **Documents list (`app/app/page.tsx`)** — responsive card grid using `Card` + `Badge(state)`; refined empty state; `NewDocumentForm` in a `Card`.
- **Document view (`components/DocumentView.tsx` + sidebar/editor)** — wrap rendered markdown container in themed `prose` (see typography below); restyle the review bar (Approve/Request-changes via `Button` primary/danger), the comment composer, and `CommentSidebar` threads (incl. the orphaned section) using `Card`/`Badge`. The `doc-body`, mark highlights, and all testids stay.
- **Inbox (`app/app/inbox/page.tsx` + `InboxList`)** — list of `Card` rows, unread emphasis, type label + doc title + relative time; `notification` testid + deep links preserved; `Mark all read` button.
- **Settings → tokens (`app/app/settings/tokens/page.tsx` + `TokenManager`)** — `Card`-framed token list + create form (`token label` input, `Create token` button, `new-token` reveal), revoke buttons, and the setup snippet in a styled `<pre>`.
- **Auth (`app/login/page.tsx`, `app/register/page.tsx`)** — centered branded card; `Input`/`Button`; keep aria-labels + `Sign up` name and redirects.
- **Landing (`app/page.tsx`)** — redesigned public hero: product one-liner ("Pull-request review, but for the plan — before the agent builds"), a short value blurb, and CTAs to `/register` / `/login`. Token-styled; light + dark.

### Markdown typography
- Add dependency `@tailwindcss/typography`; register it in `app/globals.css` (Tailwind v4: `@plugin "@tailwindcss/typography";`).
- Apply `prose` (+ `dark:prose-invert` equivalent via tokens) to the rendered-markdown containers in `DocumentView` and `DocumentEditor`'s preview pane. Tune prose color vars to the palette. This is the fix for today's unstyled `prose` usage.

## Data flow / behavior
No behavioral change. Same routes, same client state, same SSE/notifications. Purely markup + CSS + a typography dependency. The `AppNav` reuses the layout's existing `session`/`unreadCount`.

## Error / edge handling
- Dark mode must not produce unreadable hardcoded-light surfaces — all colors come from tokens.
- Empty states for documents and inbox are explicitly styled.
- Long titles/markdown wrap; nav remains usable on narrow viewports.

## Testing strategy
This phase is visual; correctness is "didn't break anything + nav reachable."
- **Existing suites are the primary gate:** `pnpm test:unit` (30) and `pnpm test:e2e` (all specs: auth, review, versioning, integration) MUST still pass — this proves all preserved selectors/labels/names still resolve.
- **New e2e smoke** `tests/e2e/navigation.spec.ts`: after register, the header shows Documents/Inbox/Settings; clicking **Settings** lands on `/app/settings/tokens` (token UI visible); clicking **Inbox** lands on `/app/inbox`. (Closes the "Settings unreachable" gap with a regression test.)
- `pnpm build` clean.
- Manual/`frontend-design` visual check; optionally a later `gsd-ui-review` pass.

## Components & build order (units)
1. **Design tokens** — rewrite `app/globals.css` (tokens + dark + typography plugin); add `@tailwindcss/typography` dep. *(independent; foundational)*
2. **UI primitives** — `components/ui/{Button,Input,Textarea,Card,Badge}.tsx`. *(blocked by 1)*
3. **App shell / nav** — `components/AppNav.tsx` + refactor `app/app/layout.tsx`; preserve `current-user` + add `inbox-link`. *(blocked by 2)*
4. **Documents list + New-doc form** polish. *(blocked by 2)*
5. **Document view + sidebar + editor** polish incl. `prose` typography. *(blocked by 1, 2)*
6. **Inbox + Settings/tokens** polish. *(blocked by 2, 3)*
7. **Auth + landing page** polish. *(blocked by 2)*
8. **Navigation e2e smoke** + full-suite/build verification. *(blocked by 3, 4, 5, 6, 7)*

## Conventions (carried)
- Plain commit messages, **no AI attribution trailer**. SCM Breeze: Write/Edit, single-line Bash, `command git`. pnpm v11 in this worktree needs `CI=true` for script runs (avoids the TTY modules-purge abort). Free port 3000 before `pnpm test:e2e`.
- Tailwind v4 (`@import "tailwindcss"` + `@theme inline` + `@plugin`). Next 16 conventions unchanged.
- Branch `ui-polish`; rebase onto `main` if it advances.
