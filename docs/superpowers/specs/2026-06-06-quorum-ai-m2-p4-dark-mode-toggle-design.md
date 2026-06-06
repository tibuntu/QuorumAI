# Quorum AI · M2/P4 — Dark-Mode Toggle (Design)

**Status:** Approved design, ready for implementation plan
**Milestone/Phase:** M2 · P4
**Depends on:** Nothing functional (UI-only). Independent of P2/P3.
**Date:** 2026-06-06

## Context

Theming is already token-based: `app/globals.css` defines light CSS custom properties on
`:root` and overrides them under `@media (prefers-color-scheme: dark)`, mapped into Tailwind
v4 via `@theme inline`. So the app **follows the OS** but offers no user choice — a user on a
dark OS can't force light, or vice-versa. P4 adds an explicit, persisted **light / dark /
system** control. UI-only; no functional dependencies.

## Locked decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Persistence | **localStorage + inline no-flash script** | Standard (next-themes-style) approach; no DB/SSR plumbing. Theme is a per-device UI concern. |
| D2 | Control | **3-way: light / dark / system** | `system` stays a first-class choice (follow OS), not lost after first toggle. |
| D3 | Theming mechanism | **Class-based** (`.dark` on `<html>`), JS-resolved | Script resolves `system` via `matchMedia` and toggles `.dark` before paint; dark tokens move from the media query to a `:root.dark` selector. |
| D4 | No-JS fallback | **Light** | If JS is disabled the `.dark` class is never set → light theme. Acceptable for this app. |

## Architecture

### `app/globals.css` — class-based dark tokens
- Keep the light tokens on `:root` unchanged.
- **Move the dark token block** from `@media (prefers-color-scheme: dark)` to **`:root.dark`**
  (same variable values). `system` is resolved in JS (which adds/removes `.dark`), so the
  media query is no longer the trigger and is removed to avoid double-sourcing.
- `@theme inline` mapping is unchanged — Tailwind utilities keep resolving the same vars.
- App styles components by swapping CSS vars (no `dark:` utilities today), so no Tailwind
  `darkMode`/variant config is required.

### `lib/theme.ts` — shared constants + resolver (new, pure)
- `type ThemeChoice = "light" | "dark" | "system"`; `STORAGE_KEY = "quorum-theme"`.
- `resolveDark(choice, prefersDark): boolean` — pure function (`dark`, or `system && prefersDark`).
  Unit-testable without a DOM.
- `THEME_SCRIPT: string` — the exact inline-script source (reads localStorage, computes
  `resolveDark` against `matchMedia`, toggles `document.documentElement.classList`). Single
  source of truth shared by the layout and the toggle.

### `app/layout.tsx` — no-flash injection
- Add a blocking `<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />` in `<head>`
  so the `.dark` class is set **before first paint** (no FOUC). `<html>` already has
  `suppressHydrationWarning`, which covers the script-set class.

### `components/ThemeToggle.tsx` — client control (new)
- 3-way segmented/cycling control rendered in the header.
- On change: write the choice to `localStorage[STORAGE_KEY]` and apply the resolved class
  immediately (reuse `resolveDark`).
- When choice is `system`, attach a `matchMedia('(prefers-color-scheme: dark)')` listener so
  the theme tracks live OS changes; detach when the choice is explicit light/dark.
- Initialize from `localStorage` on mount (defaults to `system`).

### `components/AppNav.tsx` — placement
- Insert `<ThemeToggle />` in the right-hand header cluster (alongside the user email /
  Sign out), per the existing `flex items-center gap-4` group.

## Data flow

```
initial load:  <head> THEME_SCRIPT → reads localStorage → resolveDark(choice, OS) → toggles html.dark   (pre-paint, no FOUC)
user action:   ThemeToggle → set localStorage[choice] → resolveDark → toggle html.dark
system mode:   matchMedia change listener → re-resolve → toggle html.dark
CSS:           html.dark { dark tokens }  // everything restyles via var() swap
```

## Error handling

- `localStorage` unavailable (private mode / blocked) → script try/catch falls back to
  `system`/OS detection; toggle still works in-session, just not persisted.
- Unknown stored value → treated as `system`.

## Testing

**Unit (`lib/theme.ts`)**
- `resolveDark`: `dark`→true; `light`→false; `system`+prefersDark→true; `system`+!prefersDark→false.

**Integration/e2e**
- Toggle to **dark** → `<html>` has `.dark`; reload → still dark (persisted).
- Toggle to **light** on a dark-OS-emulated context → `.dark` absent (user override wins).
- Toggle to **system** → class matches the emulated `prefers-color-scheme`.
- No-FOUC smoke: dark persisted, fresh load asserts `.dark` present on first rendered HTML.

## Out of scope (deferred)

- Cross-device sync (DB-backed preference); per-component theme overrides; additional themes
  beyond light/dark; animated theme transitions.

## Files

**New:** `lib/theme.ts`, `components/ThemeToggle.tsx`, unit test under `tests/unit/`,
e2e case under `tests/e2e/`.

**Modified:** `app/globals.css` (media-query → `.dark` class), `app/layout.tsx` (no-flash
script), `components/AppNav.tsx` (toggle placement).
