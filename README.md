# Consensum

> *"The consensus your agents must reach before building."*

A self-hostable web app that brings team collaboration back into agentic-AI development —
**pull-request review, but for the _plan_, before the agent implements.**

## Why

Agentic AI turned every developer into a silo: each drives a private agent session whose
context is invisible to teammates, and plans get approved by one human plus one agent — with
no point where the **team's** judgment enters. The cross-perspective review that made teams
strong quietly disappeared.

Consensum re-inserts the team at the highest-leverage moment: **before the agent acts.** A
developer's agent drafts a plan; instead of solo-approving it, the artifact goes up for
**async team review**; consolidated feedback flows **back into the agent**, which revises,
then implements.

## The hero loop

1. A developer's Claude Code agent drafts a plan and runs `/consensum-push-plan` → it posts
   to your Consensum instance and hands control back (no blocking).
2. The team opens the **rendered** plan and reviews async: select-to-comment, threads,
   suggestions, and an **Approve / Request-changes** verdict.
3. The developer runs `/consensum-pull-feedback` → the agent receives the **consolidated**
   team feedback and revises before implementing.

## Features

- **Review loop** — push a plan via the machine API, review it in a production-themed UI
  (rendered markdown, select-to-comment annotations, threads, resolve, suggestions-as-edits),
  and pull consolidated feedback back into the agent. Configurable approval thresholds.
- **Versioning** — edit plans into new versions with annotations re-anchored across edits,
  plus a side-by-side version diff.
- **Real-time collaboration** — live presence and rosters, shared selections and cursors,
  review-together sessions, and live updates over Server-Sent Events.
- **Agent integration** — a versioned structured-feedback contract, a block-until-approved
  long-poll, and HMAC-signed outbound webhooks.
- **Access & auth** — per-document authorization, scoped machine-API tokens, email+password
  with an optional generic OIDC SSO provider.
- **Notifications** — in-app inbox, live stream, opt-in desktop, and env-gated SMTP digests.
- **Deployment** — single-container packaging with embedded SQLite (WAL); optional
  PostgreSQL for multi-replica. Liveness/readiness probes and dark mode included.

## Quickstart

Consensum runs as **one container** with an embedded SQLite database (WAL) — no external
services. Data persists in a named volume.

```bash
AUTH_SECRET=$(openssl rand -base64 32) \
REGISTRATION_ALLOWLIST=you@example.com \
docker compose up
# → http://localhost:3000
```

> **Registration is fail-closed.** Set `REGISTRATION_ALLOWLIST` (an email, a bare domain, or
> `*` for open signup) or you won't be able to create the first account. See
> [docs/operations.md](docs/operations.md#first-run--registration).

Register a user, then create an API token under **Settings → API tokens** for the agent
integration. To run from source for development, see [CONTRIBUTING.md](CONTRIBUTING.md).

> **Migrating from Quorum AI?** The product was renamed to Consensum with breaking changes
> (env vars, token prefix, webhook headers, data volume). See
> [docs/UPGRADING.md](docs/UPGRADING.md).

## Connecting your agent

Install the Claude Code slash commands (and the optional auto-proceed hook):

```bash
curl -fsSL https://raw.githubusercontent.com/tibuntu/consensum/main/scripts/install.sh | bash
```

Then `/consensum-push-plan` posts a plan and `/consensum-pull-feedback` pulls the verdict
back. Full setup, the hands-off hook, and the machine-API reference are in
[docs/agent-integration.md](docs/agent-integration.md).

## Documentation

- [Operations](docs/operations.md) — deployment (Docker/Kubernetes/PostgreSQL), health
  checks, registration, OIDC SSO, webhooks, email, and configuration.
- [Agent integration](docs/agent-integration.md) — slash commands, the auto-proceed hook,
  and the machine API.
- [Architecture](docs/architecture.md) — stack, project layout, and conventions.
- [Architecture Decision Records](docs/adr/) — rationale behind key design and security
  decisions.
- [Upgrading](docs/UPGRADING.md) — migrating from Quorum AI.
- [Contributing](CONTRIBUTING.md) — local development, testing, and conventions.

## Stack

Next.js 16 (App Router, React 19) · Prisma 7 + SQLite (optional PostgreSQL) · better-auth ·
CodeMirror 6 · Tailwind CSS 4 · Server-Sent Events. See
[docs/architecture.md](docs/architecture.md) for the full picture.

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Timo Hankamer.
