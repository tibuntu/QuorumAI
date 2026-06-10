# Quorum AI — M6 Roadmap: Review Depth & Polish

> **Status:** Approved milestone roadmap. Each phase below runs its own `brainstorming → writing-plans → execute` cycle (same as M1–M5 phases). This doc is the milestone-level scope + sequence, not a phase spec.
> **Follows:** M5 (real-time review sessions — presence, shared selections, live cursors, session lifecycle, follow-the-leader) — all shipped on `main`.

## Theme

M1 made review work; M2 made it safe and pleasant; M3 sharpened the agent-in-the-loop moat; M4 tightened governance, lifecycle, and awareness; M5 added the synchronous "review together" dimension. M6 is deliberately **small and infra-free**: it sharpens the core review verdict, finishes the long-deferred general UI polish, and gives notifications per-type control. No new dependencies, no new processes — single Next process, SQLite, the existing event/outbox/SSE machinery.

Two backlog items are **dropped entirely** (not merely deferred): dedicated **Slack/Teams message formatters** and **git export**. The generic signed-webhook system (M3/P4) remains the integration surface.

## Phases

Sequential by ship order (P1 → P2 → P3), but each is independently shippable and Playwright-testable.

### P1 · General UI polish
- **Scope:** finish the deferred general-UI-polish phase. **Begin with a fresh audit of current code** — the `docs/superpowers/2026-06-06-quorum-ai-ui-review.md` is stale: its two top findings (dark-mode prose, danger contrast) are already fixed (`app/globals.css:75-95` drives `@tailwindcss/typography` off tokens that flip via `:root.dark` at `:25-46`; `--danger-fg` exists at `:21,45`). Likely-still-open (confirm, don't assume): responsiveness — stack the document sidebar/body, gate `sticky` behind `lg:` (`components/DocumentView.tsx` ~`:265,287`); nav header wrap + email truncation at narrow widths (`components/AppNav.tsx:14-49`); auth link affordances / visible field labels; markdown-rendering refinements (`RenderedMarkdown`, `DocumentView.tsx:63-64`).
- **Hard constraints:** **Do NOT add a Settings nav button** — Settings already lives as a main-nav link → `/app/settings/notifications` with a sub-nav (`components/AppNav.tsx:11`, `app/app/settings/layout.tsx`); keep it. Stay within the "Violet consensus" token system (no colors/spacing outside tokens). Preserve existing `data-testid` / `aria-label` / button-name test hooks.
- **Verify:** responsive doc page + nav at mobile widths; light + dark both correct; existing test hooks intact.
- **Depends on:** nothing.

### P2 · Granular per-type notification preferences
- **Scope:** replace the two global booleans (`User.emailNotifications`, `User.desktopNotifications`) with per-type control over the four types the system already emits — **comment · review · version · resolve** (`lib/notifications.ts:5,7-44`). Schema: per-(user, type, channel) preference (planner weighs a `NotificationPref` table vs. JSON on `User`); default-on to preserve current behavior. Dispatch: `notifyParticipants()` consults per-type prefs for both the in-app create/publish loop and the `EMAILABLE` email-digest enqueue; gate the client-side desktop fire (`components/NotificationProvider.tsx`) per-type too. UI: extend `components/NotificationSettings.tsx` (two checkboxes today) into a per-type matrix; extend `PATCH /api/settings/notifications` with strict validation. Decide whether `resolve` gains an email channel or stays in-app-only.
- **Verify:** toggles persist; muting a type suppresses in-app + email + desktop for that type only; others still fire; defaults preserve today's behavior.
- **Out of scope:** new notification *types*; webhook event filtering (already per-event via `Webhook.events`).
- **Depends on:** nothing (sequence after P1 since P1 may restyle `NotificationSettings.tsx`).

### P3 · Quorum / N-approver thresholds
- **Scope:** let a document owner require **N approvals** before a plan reaches `APPROVED`, and surface progress. The engine already honors `requiredApprovals` (`lib/review-state.ts:8-13`, passed in at `lib/reviews.ts:18`); `Document.requiredApprovals` exists (default `1`) but is **never set** — so this is purely config + display, no state-machine change. Set the value on create (`components/NewDocumentForm.tsx` + create route) and edit, and in the machine API (`POST /api/plans`, `PATCH /api/plans/[id]`) with validation (`>= 1`, sane upper bound). Display "N of M approvals" in `DocumentView`/sidebar/badge; surface threshold + count in consolidated feedback (`lib/feedback.ts`) for the agent loop. Edge cases: lowering below current approvals → recompute to `APPROVED`; raising → back to `OPEN`.
- **Verify:** owner sets threshold via UI + API; progress shows; plan flips to APPROVED only at threshold; threshold changes recompute state correctly.
- **Out of scope:** weighted/role-based approvals; required *specific reviewers*.
- **Depends on:** nothing.

## Sequence

```
P1 General UI polish          (fresh audit → responsive + affordance fixes)
        │
        └─ P2 Granular notification prefs   (per-type matrix over existing dispatch)
                  │
                  └─ P3 Quorum / N-approver thresholds   (expose requiredApprovals end-to-end)
```

## Explicitly deferred → M7+
Postgres migration & multi-instance · teams/org model & multi-tenancy · admin/moderator roles · enforced-SSO / multiple-provider / SCIM · soft-delete / trash / recovery · version checkpointing/compaction · multi-hunk suggestion patches.

_(Removed from the backlog entirely in M6: dedicated Slack/Teams formatters; git export.)_

## Per-phase workflow
For each phase, in a fresh session on a fresh worktree off the latest local `main`:
1. `brainstorming` → phase design spec in `docs/superpowers/specs/2026-06-10-quorum-ai-m6-pN-*-design.md`.
2. `writing-plans` → implementation plan + `.tasks.json` in `docs/superpowers/plans/`.
3. `executing-plans` (or `subagent-driven-development`) → implement, verify, land.

**Env/workflow notes carried from M1–M5:** this repo's pnpm v11 needs `CI=true` on script runs; free port 3000 before `pnpm test:e2e` (`lsof -ti tcp:3000 | xargs -r kill -9`); after schema/migration changes restart dev + `prisma migrate deploy` + `prisma generate` (client gitignored, DB per-checkout); rebase onto local `main` (don't merge main in); phases land by fast-forwarding into local `main` (not via PR), don't push unless asked; pure libs → services → thin routes → client; value-sets in `lib/enums.ts`.
