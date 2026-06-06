# Quorum AI — M3 Roadmap: Deepen the Agent Loop + SSO + Suggestions

> **Status:** Approved milestone roadmap. Each phase below runs its own `brainstorming → writing-plans → execute` cycle (same as M1/M2 phases). This doc is the milestone-level scope + sequence, not a phase spec.
> **Follows:** M2 (Authorization + Email + Version-diff + Dark-mode) — landing now.

## Theme

M1 made review work; M2 made it safe and pleasant. M3 sharpens the **moat**: the agent-in-the-loop machine API. Today an agent pushes a plan and pulls back a **flat markdown digest**, then has to be re-run by hand to check for a decision. M3 turns that into a real control loop — a **structured, filterable feedback contract**, **block-until-approved** waiting, and **outbound webhooks** so CI/agents are *told* when a decision lands. It also closes the two most-requested deferred items: **OIDC/SSO** login and **suggestions-as-applyable-edits**.

The unlock under all of it is a **durable outbox** — the in-memory email/event machinery from M1/M2 is single-process and lost on restart, which is fine for live UI but not for reliable outbound delivery.

## Phases

P1 ships first (it's the foundation P4 needs and a safer home for email). P2, P3, P5, P6 are independent and may run in any order or in parallel sessions once P1 is merged. P4 depends on P1's outbox.

### P1 · Foundations & durable outbox  _(first — foundation)_
- **Problem:** Reliable outbound delivery (webhooks) and durable batched email need state that survives a restart and a single worker that drains it with retry/backoff. Today `lib/email-digest.ts` and `lib/events.ts` are in-memory, single-process. Separately, several FK columns lack indexes and the structured-feedback work (P2) needs a place to record severity/category.
- **Scope:** A durable `OutboxJob` table + an in-process polling worker (started at server bootstrap) with status/attempts/backoff/dead-letter. Migrate the email digest flush onto it (keep the 45 s debounce semantics; SSE stays in-memory — it's inherently live/ephemeral). Add the missing FK indexes. Add nullable `severity` + `category` to `Annotation` (powers P2 filtering).
- **Out of scope:** distributed/multi-worker queues, Postgres, external brokers (Redis/Bull) — SQLite single-instance stays.
- **Depends on:** nothing. **Blocks:** P4 (delivery), and is a cleaner home for P2's severity field.

### P2 · Structured feedback contract  _(the moat)_
- **Scope:** Evolve `GET /api/plans/[id]/feedback` from "markdown + loosely-shaped threads/reviews" into a **versioned JSON contract** (`schemaVersion`): per-thread `severity`/`category`, anchor state, resolved state; **provenance** (current version number + lineage, per-thread "created on vN / now on vN"); **rollup counts** (`blocking`, `unresolved`, `byCategory`, `byVersion`). Add **filtering** query params (`?include=blocking,unresolved`, `?exclude=resolved`). Keep the `markdown` field for humans; agents consume the structured fields. Update the `/pull-feedback` skill to present blockers first.
- **Out of scope:** new comment UI for severity (a minimal author/reviewer affordance is fine; rich triage UI is M4); changing the verdict model.
- **Depends on:** P1 (the `Annotation.severity`/`category` fields).

### P3 · Block-until-approved long-poll
- **Scope:** A new `GET /api/plans/[id]/feedback/wait?timeoutMs=` that holds the request open until the document's decision/state changes (subscribe via `lib/events.ts` + a DB re-check on connect to avoid the race) or the timeout elapses (returns the current `pending` snapshot). The `/pull-feedback` skill gains a loop that re-arms until `approved`/`changes_requested`. Bounded server-side max timeout; reuses the P2 contract for the body.
- **Out of scope:** persistent server-push to laptops (that's P4 webhooks for CI); WebSockets.
- **Depends on:** nothing structurally (uses existing event bus); shares the P2 response shape if landed after.

### P4 · Outbound webhooks / status callbacks  _(needs P1 outbox)_
- **Scope:** A `Webhook` registration (owner- and/or document-scoped: target URL, signing secret, event filter, active flag). On event, enqueue an `OutboxJob`; the worker POSTs a **signed** payload (HMAC-SHA256 over the body, timestamped header) with retry/backoff and dead-letter after N attempts. Events: `version.created`, `review.updated`, `decision.changed` (→ approved / changes_requested), `comment.created`. Minimal management API + settings UI; a delivery log. Lets CI/agents register a callback and be *notified* when a decision lands (the server-context complement to P3's long-poll).
- **Out of scope:** dedicated Slack/Teams message formatters (generic webhook only — Slack/Teams pretty formatters stay M4); per-event templating.
- **Depends on:** P1 (outbox + worker).

### P5 · Suggestions-as-edits
- **Scope:** Let a reviewer attach a **concrete proposed text** to a `kind=SUGGESTION` annotation (reusing the existing anchor range). The author/agent can **accept** → applies the suggested text at the anchor and creates a new version via the existing `createVersion()` (which already re-anchors annotations + dismisses approvals), or **reject** → resolves the thread. Reviewer UI to propose, author UI to accept/reject; accepted-suggestion provenance surfaces in the P2 feedback contract so the agent sees "applied as vN".
- **Out of scope:** multi-hunk patches, conflict resolution when the anchor has drifted to ORPHANED (reject + re-propose in that case), suggestion batching.
- **Depends on:** nothing structurally; richer when P2 is present (provenance surfacing).

### P6 · Generic OIDC login
- **Scope:** One configurable **generic OIDC provider** (Keycloak / Authentik / Azure AD / Auth0) wired into better-auth in `lib/auth.ts`, **env-gated** (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`) — no-op + hidden when unset, like the SMTP gate. Keep email/password. "Sign in with SSO" button on the login page; account linking via the existing `Account` model (no schema change — `providerId` + `@@unique([accountId, providerId])` already support it). Update `.env.example` + README.
- **Out of scope:** multiple simultaneous OIDC providers, SCIM/just-in-time org provisioning, enforced-SSO mode, named social buttons (Google/GitHub) — all M4.
- **Depends on:** nothing.

## Sequence

```
P1 Foundations & outbox ──▶ ┌── P2 Structured feedback contract
                            ├── P3 Block-until-approved long-poll
                            ├── P5 Suggestions-as-edits
                            ├── P6 Generic OIDC login   (P2/P3/P5/P6 any order / parallel)
                            └── P4 Outbound webhooks     (needs P1's outbox)
```

## Explicitly deferred → M4+
Postgres migration & multi-instance · teams/org model & multi-tenancy · presence + live "review together" · optional git export · dedicated Slack/Teams message formatters (beyond generic webhooks) · enforced-SSO / multiple-provider / SCIM · version checkpointing/compaction · multi-hunk suggestion patches.

## Per-phase workflow
For each phase, in a fresh session on a fresh branch off the latest `main`:
1. `brainstorming` → phase design spec in `docs/superpowers/specs/` (P1–P6 design specs already drafted alongside this roadmap — refine in the brainstorm).
2. `writing-plans` → phase implementation plan + `.tasks.json` in `docs/superpowers/plans/`.
3. `executing-plans` (or `subagent-driven-development`) → implement, verify, PR.

**Worktree/env notes carried from M1/M2:** create an isolated worktree at execution time; this repo's pnpm v11 needs `CI=true` on script runs; free port 3000 before `pnpm test:e2e`; preserve existing `data-testid`/`aria-label` test hooks; rebase onto `main` (don't merge main in); pure libs → services → thin routes → client; value-sets in `lib/enums.ts`.

## Note: OIDC may warrant an ADR
P6 is an authentication-architecture decision. Before implementing, evaluate whether an Architecture Decision Record is warranted (generic-OIDC-alongside-password vs. enforced SSO; account-linking policy). Draft via the `adr` skill if so.
