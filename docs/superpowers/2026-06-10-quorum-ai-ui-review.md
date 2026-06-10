# Quorum AI — UI Review (6-Pillar Visual Audit)

> **Date:** 2026-06-10
> **Method:** Live Playwright/Chromium screenshots in **light + dark (class-based `:root.dark`, set via `localStorage["quorum-theme"]` + `documentElement.classList.toggle("dark")`)** at **1280px and 390px**, full-page, cross-referenced against source. Two browser contexts were used to bring two users (Ada + Grace) into one document and exercise the M3–M5 real-time surface (presence roster, remote cursors, remote selections, review session + follow-the-leader, suggestion/diff cards, version-history diff).
> **Scope:** The whole app — landing, auth, documents list, document view, content-rich markdown rendering, the inline markdown editor (CodeMirror + preview), version history/diff, inbox, settings (notifications/tokens/webhooks), **and the never-before-reviewed M3–M5 real-time collaboration surface**.
> **Design intent baseline:** "Violet consensus" — `docs/superpowers/specs/2026-06-05-quorum-ai-ui-polish-design.md`; tokens in `app/globals.css`.
> **Prior review:** the 17/24 audit from `docs/superpowers/2026-06-06-quorum-ai-ui-review.md`. Every concrete finding in that doc (dark-mode prose invisible, mobile document page broken, danger-button contrast, nav overflow, auth-link affordance, missing field labels, sparse landing) is **fixed** in current code and was re-verified here; this is a fresh pass against the current build, with first coverage of the real-time surface.

## Score summary

| Pillar | Score |
|--------|-------|
| Copywriting | 4/4 |
| Visuals | 3/4 |
| Color | 3/4 |
| Typography | 3/4 |
| Spacing | 3/4 |
| Experience Design | 3/4 |
| **Overall** | **19/24** |

**Headline:** The app has materially improved since the 2026-06-06 baseline — the two systemic defects that dominated that review (unreadable dark-mode prose, broken mobile document page) are both resolved, the landing page is now a proper marketed page with header/footer/3-step explainer, auth has real labels and links, and a genuine three-way theme toggle (light/dark/system) ships in the nav. The remaining issues are narrower and concentrated in the **editing + collaboration surface**: the CodeMirror editor pane keeps a hard-coded light theme in dark mode (the single clearest defect now), form checkboxes ignore the violet brand, and several real-time chrome elements (session banner, presence labels, diff column headers) are functional but un-polished. Nothing breaks the core read/review loop in either theme or width anymore.

---

## 1. Copywriting — 4/4

*Strong, confident, consistent copy throughout; nothing material to fix.*

**What works**
- Landing is sharp and on-message: hero *"Pull-request review, but for the plan — before the agent builds."*, a "Plan review for the age of agents" eyebrow, and a 3-step explainer (Push the plan → Review together → Pull feedback) that names the real `/push-plan` and `/pull-feedback` commands (`app/page.tsx:7-23`).
- Action labels are verb-first and unambiguous: `Get started`, `Approve`, `Request changes`, `Create document`, `Create token`, `Create webhook`, `Resolve`/`Reopen`, `Accept`/`Reject` (on suggestions).
- Real-time microcopy reads naturally: `You're leading · 2 participants`, `<Name> is leading a review session · 2 in session`, `Following <Name>`, `Jump back to <Name> · Resume` (`components/SessionBanner.tsx:46-72`).
- Empty/guidance states are written, not blank: `No tokens yet.`, `No webhooks yet.`, `Select text in the document to add a comment.`, and security copy is correct: *"Copy this token now — it won't be shown again."* / *"Copy this signing secret now…"* (`components/TokenManager.tsx:118`, `components/WebhookManager.tsx:101`).

**Findings** — none material.

---

## 2. Visuals — 3/4

*Cohesive identity and a real primitive set; ceiling is still literal-glyph branding and a few unstyled native controls.*

**What works**
- Consistent "Violet consensus" identity across surfaces: `◆ Quorum` wordmark, soft rounded `Card` primitives, pill badges, primary-subtle accents on the landing step numbers and active nav (`app/page.tsx:42,62`, `components/AppNav.tsx:30`).
- Document state is communicated with semantic badges (amber `Open`, green `Approved`) on both the documents list and the review bar.
- Suggestion cards are visually clear: struck-through old text in red over green proposed text, with `Accept`/`Reject` actions (`components/CommentSidebar.tsx:53-87`); annotation highlights render as amber inline marks on the body.
- Code blocks, inline-code chips, and tables are tastefully themed via token-driven prose overrides (`app/globals.css:96-134`).

**Findings**
- `[low]` Brand mark is still a literal `◆` glyph rather than real iconography; nav links are text-only, no favicon-grade mark. Fine for product stage but it's the ceiling on craft. — `components/AppNav.tsx:21` *(subjective: brand feel)*
- `[low]` Form checkboxes (token scopes, webhook events) and the expiry `<select>` are native/unstyled, so they render in the browser's default blue accent that clashes with the violet palette — visible on the tokens and webhooks settings forms. The prose task-list checkboxes get `accent-color: var(--primary)` but these form controls do not. — `components/TokenManager.tsx:95`, `components/WebhookManager.tsx:78` *(objective: add `accent-color: var(--primary)` to these inputs)*
- `[low]` Presence avatars and cursor labels use a fixed Tailwind color ramp (`bg-rose-500` … `bg-fuchsia-500`) independent of the design tokens, so they don't shift between themes and can sit slightly hot against the dark surface. — `lib/presence-roster.ts:3-6` *(subjective: visual harmony)*

---

## 3. Color — 3/4

*Token system is disciplined and now drives prose correctly in both themes; the one real gap is the editor pane, which never went dark.*

**What works**
- Single token set with a class-based `:root.dark` override exposed to Tailwind v4 via `@theme inline` — no raw hex scattered through components (`app/globals.css:4-64`).
- **Dark-mode prose is now correct** (the baseline `[critical]`): `--tw-prose-*` vars are mapped to the token system under `.prose`, so headings, body, bold, blockquotes, table borders, and code chips all read with proper contrast in dark mode — re-verified on the document view (`app/globals.css:77-94`).
- **Danger contrast is fixed**: `Button` `danger` now uses the dedicated `--danger` / `--danger-fg` tokens (deep red + white) instead of the light-red state token, and reads well in both themes (`components/ui/Button.tsx:10`, `app/globals.css:22-23,45-46`). The nav unread badge uses the same `bg-danger text-danger-fg` (`components/AppNav.tsx:34`).
- Diff rows use semantic state-bg tokens (`--state-changes-bg` removed, `--state-approved-bg` added) that flip cleanly between themes (`components/VersionHistory.tsx:58-65`).

**Findings**
- `[high]` **The CodeMirror editor pane keeps a light theme in dark mode.** In edit mode the left pane renders white-background with light syntax colors while the rest of the page is dark, so it reads as a glaring white panel and the syntax tokens have weak contrast. No dark editor theme is wired up. — `components/DocumentEditor.tsx:28-34` *(objective: pass a dark CodeMirror theme/extension gated on the resolved theme)*
- `[low]` Native form checkboxes/`select` render in browser-default blue rather than the violet accent (also called out under Visuals). — `components/TokenManager.tsx:95`, `components/WebhookManager.tsx:78` *(objective)*
- `[low]` Dark-mode prose task-list checkboxes are low-contrast when unchecked: the default checkbox box on the dark surface is faint, and only the checked state shows the `--primary` accent. — `app/globals.css:131-134` *(objective: style the unchecked box for the dark surface)*

---

## 4. Typography — 3/4

*Excellent markdown typesetting in both themes now; small refinements remain around the leading-H1 duplication and diff readability.*

**What works**
- Geist sans/mono with a clear hierarchy (page H1 `text-2xl font-semibold`, section headings, muted secondary text) on every surface.
- **Markdown rendering is strong in BOTH themes**: headed sections, ordered/unordered lists, GFM task lists with aligned accent checkboxes, inline-code chips, themed fenced code blocks, GFM tables, and styled blockquotes all render cleanly — re-verified light and dark on the document view and editor preview (`app/globals.css:77-134`).
- The editor offers a syntax-highlighted CodeMirror pane beside a live token-themed typeset preview (`components/DocumentEditor.tsx:26-38`).

**Findings**
- `[medium]` Author markdown that opens with `# Title` renders a body H1 immediately under the page-level `<h1>{doc.title}</h1>`, producing two stacked top-level headings on the document view (in the captured doc, "Billing event sourcing" then "Migrate billing to event sourcing"). Reads as a duplicated heading. — `components/DocumentView.tsx:635,664` *(subjective: content-dependent; could de-emphasize the page title or demote the first body H1)*
- `[low]` The version-history diff renders monospace at `text-xs` with no per-column version header (the `v1 → v2` selectors sit above, but the two diff columns aren't individually labeled), so on a long document the two columns are dense and it's easy to lose which side is old vs new. — `components/VersionHistory.tsx:38-44` *(subjective: density/labeling)*
- `[low]` Remote presence cursor labels are `text-xs` white-on-color pills positioned by percentage; on a dense body they can land mid-paragraph and are easy to miss at a glance. — `components/PresenceCursors.tsx:22-27` *(subjective)*

---

## 5. Spacing — 3/4

*Desktop rhythm is good and the document page is now genuinely responsive; the editor's fixed 2-column grid is the main remaining cramp.*

**What works**
- **The document page is now responsive** (the baseline `[high]`): `flex w-full flex-col gap-6 lg:flex-row`, sidebar `w-full … lg:w-80`, and `sticky` gated behind `lg:`, so at 390px the body fills the width and the sidebar stacks beneath instead of overlapping — re-verified on mobile (`components/DocumentView.tsx:616,670`).
- **The nav header now wraps and truncates** (the baseline `[medium]`): `flex-wrap … gap-x-4 gap-y-2` plus a `max-w-[45vw] truncate` on the email, so nothing clips at 390px (`components/AppNav.tsx:19,42`).
- Consistent card padding (`p-6`/`p-4`/`p-3`), comfortable gaps, centered max-width content columns, and a clean documents grid that collapses to one column on mobile.

**Findings**
- `[medium]` The editor is a fixed `lg:grid-cols-2` (CodeMirror + preview); the CodeMirror pane has no horizontal scroll affordance for long lines, so table rows and long code lines are clipped at the pane's right edge (visible in edit mode at 1280px). — `components/DocumentEditor.tsx:26-35` *(objective: enable line wrapping or horizontal scroll in the editor pane)*
- `[low]` The session banner, presence roster, Edit/History/Delete controls all share one flex row beside the title; with a session active the row gets busy and, while it wraps, it can feel crowded on mid widths. — `components/DocumentView.tsx:634-654` *(subjective)*
- `[low]` On mobile the inline editor's two panes stack (`grid-cols-1`) but each is locked to `60vh`, so editing a long document on a phone means scrolling inside a short box. — `components/DocumentEditor.tsx:30,36` *(subjective)*

---

## 6. Experience Design — 3/4

*Core review loop is solid in both themes and the real-time surface works end-to-end; rough edges are concentrated in editor dark-mode and a few un-discoverable affordances.*

**What works**
- **Navigation reachability**: Documents / Inbox / Settings in the header with active-state highlighting and an unread-count badge; a real light/dark/system `ThemeToggle` is now in the nav and persists to `localStorage` (`components/AppNav.tsx:22-44`, `components/ThemeToggle.tsx`).
- **Select-to-comment + suggest** flow is clear: selecting body text opens a composer with a `Suggest edit` toggle; suggestions render as Accept/Reject cards quoting old→new text (`components/DocumentView.tsx:687-749`, `components/CommentSidebar.tsx`).
- **Real-time collaboration works end-to-end**: presence roster shows both viewers, remote selections render as tinted marks carrying the other user's name, a leader can `Start session` → others `Join` → the banner shows participant count, and follow-the-leader shows a `Following <Name>` indicator that becomes a `Resume` button on manual scroll — all captured across two contexts.
- Token/webhook lifecycle handled correctly: one-time secret reveal, "Never used"/"Never delivered" status, `Revoke`/`Delete`, and a copy-paste CLI setup block.

**Findings**
- `[high]` Editing in dark mode is jarring because the CodeMirror pane stays light (see Color `[high]`) — the primary editing surface visually breaks the theme. — `components/DocumentEditor.tsx:28-34` *(objective)*
- `[low]` The `Start session` / `Join` / follow controls live inline in the title row with no explanatory affordance; a first-time follower sees `Following <Name>` / `Jump back to <Name> · Resume` with no tooltip or onboarding for what following does. — `components/SessionBanner.tsx:57-85` *(subjective)*
- `[low]` Remote cursor labels and selection tints have no legend mapping color→person; with 3+ participants the only name source is hovering the avatar or the floating label. — `components/PresenceCursors.tsx:14-29`, `components/PresenceRoster.tsx:33-53` *(subjective)*
- `[low]` Annotation/suggestion cards in the sidebar are click-to-focus but there's no scroll-to-anchor on click and no count/summary header beyond "Comments", so on a long thread list there's no overview. — `components/CommentSidebar.tsx:144-176` *(subjective)*

---

## Top fixes (priority order)

1. **[high] Give the CodeMirror editor a dark theme.** Wire a dark editor theme/extension (e.g. a `@codemirror` dark theme or `@uiw/codemirror-theme-*`) gated on the resolved theme so the editor pane stops rendering as a white panel in dark mode. (`components/DocumentEditor.tsx:28-34`)
2. **[medium] De-duplicate the leading body H1 vs the page title.** Either demote the first rendered `# Heading` or de-emphasize/hide the page-level title when the body opens with an H1. (`components/DocumentView.tsx:635,664`)
3. **[medium] Make the editor pane handle long lines.** Enable line wrapping or horizontal scroll in CodeMirror so tables/long code lines aren't clipped at the pane edge. (`components/DocumentEditor.tsx:26-35`)
4. **[low] Brand the native form controls.** Add `accent-color: var(--primary)` to the token-scope/webhook-event checkboxes and the expiry `<select>`, and style the dark-mode unchecked task-list checkbox box. (`components/TokenManager.tsx:95`, `components/WebhookManager.tsx:78`, `app/globals.css:131-134`)
5. **[low] Polish the collaboration chrome.** Add a tooltip/short helper for the follow-the-leader controls and consider a color→person legend for cursors/selections. (`components/SessionBanner.tsx:57-85`, `components/PresenceCursors.tsx`)

## Items needing human judgment
- Brand feel of the `◆ Quorum` wordmark / whether literal-glyph branding is acceptable for the product stage (Visuals).
- Whether to de-duplicate the leading H1 in rendered documents or accept it as authored content (Typography) — this is content-dependent.
- Whether presence avatar/cursor colors should be derived from the design tokens (theme-aware) instead of the fixed Tailwind ramp (Visuals/Color).
- How much onboarding the follow-the-leader / session controls warrant vs. keeping the title row minimal (Experience Design).

---

## Subjective decisions (resolved)

_Resolved with the user at the Task 3 checkpoint (2026-06-10). These, plus all objective findings, feed the fix tasks (P1 Tasks 4–5)._

- **Leading-H1 duplication → FIX (demote the first body H1).** When the rendered markdown's first block is an `# H1`, render it de-emphasized / not as a second `<h1>` so it doesn't compete with the page-level title; the page title stays the canonical heading. — `components/DocumentView.tsx:635,664`
- **Presence avatar/cursor/selection colors → FIX (derive from theme tokens).** Make them theme-aware instead of the fixed Tailwind rose→fuchsia ramp so they sit well on the dark surface. — `lib/presence-roster.ts:3-6`
- **Diff per-column version headers → FIX.** Label the two diff columns with their version (old `v1` vs new `v2`) so the side is unambiguous on long documents. — `components/VersionHistory.tsx:38-44`
- **Follow-the-leader / session controls helper → FIX (add short tooltip/helper).** Give first-time followers a brief affordance for what Start session / Join / Following do. — `components/SessionBanner.tsx:57-85`
- **Cursor/selection color→person legend → FIX (add small legend).** Map color → participant name for 3+ participants. — `components/PresenceCursors.tsx:14-29`, `components/PresenceRoster.tsx:33-53`
- **`◆ Quorum` glyph brand mark → LEAVE AS-IS.** Real iconography is a larger lift beyond this token-level polish phase; accepted for the current product stage.
- **Mobile inline-editor pane height (locked `60vh`) → LEAVE AS-IS.** Minor; not worth churn this phase.
- **Title-row crowding at mid widths (session banner + roster + Edit/History/Delete) → LEAVE AS-IS.** Already wraps; acceptable.

---

*Screenshots captured to `/tmp/m6p1-shots` (light+dark × 1280+390 for every static surface; desktop light+dark for the multi-context real-time surface — presence cursors/selection, session leader banner, follower + resume, suggestion/comment cards, and the v1→v2 diff). Not committed. The two-context real-time capture succeeded; the only surfaces captured desktop-only (not at 390px) are the multi-user real-time ones (presence/session/diff/sidebar cards), since they were driven through a second context at the default desktop width.*
