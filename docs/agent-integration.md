# Agent integration

The hero loop is driven by two Claude Code slash commands shipped in
[`dist/claude/commands/`](../dist/claude/commands/):
[`/consensum-push-plan`](../dist/claude/commands/consensum-push-plan.md) and
[`/consensum-pull-feedback`](../dist/claude/commands/consensum-pull-feedback.md). They talk
to your instance via the machine API.

## Install

Install the commands with the one-liner (no checkout needed):

```bash
# Slash commands → ~/.claude/commands (available in every repo)
curl -fsSL https://raw.githubusercontent.com/tibuntu/consensum/main/scripts/install.sh | bash

# …and the opt-in auto-proceed hook into the current project's ./.claude
curl -fsSL https://raw.githubusercontent.com/tibuntu/consensum/main/scripts/install.sh | bash -s -- --with-hook
```

From a checkout, run the same script locally: `./scripts/install.sh [--with-hook]`. Then
point it at your instance:

```bash
export CONSENSUM_BASE_URL="http://localhost:3000"
export CONSENSUM_API_TOKEN="<token from Settings → API tokens>"
```

`/consensum-push-plan` posts the current plan and returns a review URL. Once the team weighs
in, `/consensum-pull-feedback <id>` pulls the consolidated verdict, threads, and digest back
so the agent can revise.

## Auto-proceed (hands-off loop)

For a fully hands-off loop — the agent waits for the verdict and **proceeds on its own**
once approved — Consensum ships a Claude Code hook on the `ExitPlanMode` tool
([`dist/claude/hooks/consensum-exit-plan.mjs`](../dist/claude/hooks/consensum-exit-plan.mjs)),
which `--with-hook` installs into your project's `.claude/hooks/` and registers in that
project's `.claude/settings.json`. When the agent finishes planning, the hook **blocks
inside the plan-exit call**: it pushes the plan, waits on `/feedback/wait`, and then

- **Approved** → returns `allow`; the agent exits plan mode and implements automatically.
- **Changes requested** → returns `deny` with a consolidated feedback digest; the agent
  revises and re-presents the plan, which re-fires the hook (PATCHing a new version) —
  that's the loop.

State is scoped per Claude Code `session_id`, so a new session opens a new review while a
re-presented plan revises the same one. (Session state persists in a git-ignored
`.consensum/`.) With no `CONSENSUM_API_TOKEN` set the hook **fails closed** — it blocks
plan-mode exit rather than shipping an unreviewed plan. Set `CONSENSUM_SKIP=1` (or omit
`--with-hook`) on projects that don't use Consensum review.

For plans pushed **outside** plan mode,
[`/consensum-loop <id> [intervalMinutes]`](../dist/claude/commands/consensum-loop.md) does
the same wait-then-act loop on demand.

> **Permission mode is not auto-applied.** A team-chosen "implement with Accept Edits / Auto"
> setting is intentionally **deferred**: Claude Code does not let a hook switch the session's
> permission mode on approval
> ([claude-code#14044](https://github.com/anthropics/claude-code/issues/14044), closed as
> not-planned). The agent implements under whatever mode the session is already in.

> **Compatibility:** the hook uses the same `ExitPlanMode` `PermissionRequest` handshake as
> [plannotator](https://plannotator.ai); if your Claude Code version changes it, adjust
> `allowDecision`/`denyDecision` in the hook script.

## Machine API surface

Bearer token, owner-scoped:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/plans` | Push a plan; returns `{ id, reviewUrl }`. Scope `plans:write`. |
| `PATCH /api/plans/[id]` | Post a revised version (optimistic-locked on `baseVersionNumber`). Scope `plans:write`. |
| `GET /api/plans/[id]/feedback` | Structured feedback (`schemaVersion`, threads with severity/category, reviews, rollups, markdown). Supports `?include=` / `?exclude=` (`blocking`, `unresolved`, `resolved`, `orphaned`). Scope `feedback:read`. |
| `GET /api/plans/[id]/feedback/wait?timeoutMs=` | Long-poll: blocks until the decision/state changes or the (clamped) timeout, then returns the same body with a `timedOut` flag. Scope `feedback:read`. |

For CI or headless agents that can't hold a connection open, register an
[outbound webhook](operations.md#outbound-webhooks) instead of long-polling.
