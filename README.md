# Quorum AI

> *"The quorum your agents must clear before building."*

A self-hostable web app that brings team collaboration back into agentic-AI development — **pull-request review, but for the _plan_, before the agent implements.**

---

## Why

> The two paragraphs below are the canonical product positioning — preserved verbatim from the design discussion.

Agentic AI made each developer a silo. Every dev now drives a private Claude Code session whose context and output are invisible to teammates; plans, specs, and tickets get generated and approved by one human + one agent, then implemented — with no point where the **team's** collective judgment enters. The cross-perspective review that made teams strong (a cloud engineer catching an infra problem in a backend dev's approach, a senior's judgment rubbing off on a junior) quietly disappeared. Agentic AI became a fantastic individual force-multiplier and an accidental **collaboration-killer**.

This product re-inserts the team at the highest-leverage moment: **before the agent acts.** It is, in one line, **"pull-request review, but for the *plan* (and the ticket) — before the agent implements."** A developer's agent drafts a plan; instead of solo-approving it, the artifact goes up for **async team review**; the cloud/frontend/backend reviewers weigh in without a meeting; consolidated feedback flows **back into the agent**, which revises, then implements.

## The hero loop

1. A developer's Claude Code agent drafts a plan and runs `/push-plan` → it posts to your Quorum AI instance and hands control back (no blocking).
2. The team gets a shareable link / sees it in their inbox, opens the **rendered** plan, and reviews async: select-to-comment, threads, suggestions, and an **Approve / Request-changes** verdict.
3. The developer runs `/pull-feedback` → the agent receives the **consolidated** team feedback and revises the plan before implementing.

## Status

**M1–M3 shipped.** The product runs end-to-end in a single Docker container.

**Core review loop (M1)**
- **Push** a plan via the Bearer-token machine API (`/push-plan`).
- **Review** it in a production-themed UI: rendered markdown, select-to-comment annotations, comment threads, resolve, and an Approve / Request-changes verdict.
- **Edit** plans into new versions, with annotations **re-anchored** across edits.
- **Live updates** via Server-Sent Events, plus in-app notifications.
- **Pull** consolidated feedback back into the agent (`/pull-feedback`).

**Access & collaboration (M2)**
- **Per-document authorization** — owner + participants (link-grant on first open); scoped machine API.
- **Email notifications** — env-gated SMTP, per-user on/off, debounced activity digests.
- **Version history + diff** — browse versions and see a side-by-side markdown diff.
- **Dark mode** — light / dark / system toggle, persisted, no-flash boot.

**Deepened agent loop + SSO + suggestions (M3)**
- **Structured feedback contract** — versioned JSON (`schemaVersion`) with per-thread severity/category, provenance, rollups, and `include`/`exclude` filtering — alongside the human markdown digest.
- **Block-until-approved** — `GET /api/plans/[id]/feedback/wait?timeoutMs=` long-poll so an agent can wait for a decision.
- **Outbound webhooks** — owner-registered, HMAC-signed, durably retried delivery on review events.
- **Suggestions-as-edits** — reviewers propose concrete text; the owner accepts → a new version.
- **Generic OIDC SSO** — one env-gated OIDC provider alongside email+password (see below).

See [`docs/superpowers/STATUS.md`](docs/superpowers/STATUS.md) for live build status and [`docs/superpowers/specs/2026-06-04-quorum-ai-design.md`](docs/superpowers/specs/2026-06-04-quorum-ai-design.md) for the full design.

## Quickstart

### Run with Docker (recommended)

Quorum AI runs as **one container** with an embedded SQLite database (WAL) — no external services. Data persists in a named volume.

```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32) docker compose up
# → http://localhost:3000
```

Register a user, then create an API token under **Settings → API tokens** for the agent integration below.

### Run locally (development)

```bash
cp .env.example .env      # then set BETTER_AUTH_SECRET to a 32+ char random string
CI=true pnpm install      # CI=true required: this repo uses pnpm v11
pnpm db:migrate           # apply migrations to ./data/app.db
pnpm dev                  # → http://localhost:3000
```

## Single sign-on (optional OIDC)

Quorum supports one generic OIDC provider (Keycloak, Authentik, Azure AD, Auth0,
…) alongside email+password. It is off by default. To enable it, set:

| Variable | Purpose |
|----------|---------|
| `OIDC_ISSUER` | Issuer URL; discovery is fetched from `<issuer>/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | OAuth client credentials from your IdP |
| `NEXT_PUBLIC_OIDC_ENABLED` | Set to `true` to render the "Sign in with SSO" button |

Set `NEXT_PUBLIC_OIDC_ENABLED=true` **only together with** the three `OIDC_*` vars: the
public flag just controls the button, so enabling it alone shows a button whose sign-in
request 404s (no provider registered server-side).

Configure your IdP's redirect URI to `<BETTER_AUTH_URL>/api/auth/oauth2/callback/oidc`.

**Account linking.** An SSO sign-in whose email the IdP marks *verified* is linked
to an existing user with that email; otherwise a new `member` user is created.

**Signup under SSO.** When OIDC is configured, self-service password registration is
disabled (identity provisioning belongs to the IdP); existing password **login**
still works. See `docs/adr/ADR-Security-000-generic-oidc-sso-alongside-password.md`
for the rationale.

## Connecting your agent

The hero loop is driven by two Claude Code slash commands shipped in [`.claude/commands/`](.claude/commands/): [`/push-plan`](.claude/commands/push-plan.md) and [`/pull-feedback`](.claude/commands/pull-feedback.md). They talk to your instance via the machine API. Set:

```bash
export QUORUM_BASE_URL="http://localhost:3000"
export QUORUM_API_TOKEN="<token from Settings → API tokens>"
```

Then from any agent session: `/push-plan` posts the current plan and returns a review URL; once the team weighs in, `/pull-feedback <id>` pulls the consolidated verdict, threads, and digest back so the agent can revise.

**Machine API surface** (Bearer token, owner-scoped):

| Endpoint | Purpose |
|----------|---------|
| `POST /api/plans` | Push a plan; returns `{ id, reviewUrl }`. Scope `plans:write`. |
| `PATCH /api/plans/[id]` | Post a revised version (optimistic-locked on `baseVersionNumber`). Scope `plans:write`. |
| `GET /api/plans/[id]/feedback` | Structured feedback (`schemaVersion`, threads with severity/category, reviews, rollups, markdown). Supports `?include=` / `?exclude=` (`blocking`, `unresolved`, `resolved`, `orphaned`). Scope `feedback:read`. |
| `GET /api/plans/[id]/feedback/wait?timeoutMs=` | Long-poll: blocks until the decision/state changes or the (clamped) timeout, then returns the same body with a `timedOut` flag. Scope `feedback:read`. |

For CI or headless agents that can't hold a connection open, register an [outbound webhook](#outbound-webhooks) instead of long-polling.

## Outbound webhooks

Register a webhook (owner-scoped, optionally narrowed to a single plan) in **Settings** to be notified on review events — the server-context complement to `/feedback/wait`. Each delivery is a JSON `POST` signed with **HMAC-SHA256** (`X-Quorum-Signature: sha256=…` + `X-Quorum-Timestamp` + `X-Quorum-Event`) and delivered durably through the outbox worker with retry/backoff and dead-lettering; a per-webhook delivery log surfaces failures.

Events: `version.created`, `review.updated`, `decision.changed`, `comment.created`.

| Variable | Purpose |
|----------|---------|
| `WEBHOOK_SECRET_KEY` | App key that encrypts stored signing secrets at rest (AES-256-GCM). **Recommended in production** — without it secrets are stored as plaintext (`v0:` marker) so dev/CI can run keyless. |
| `WEBHOOK_ALLOW_INSECURE` | Dev-only: allow `http://` / loopback / link-local targets. In production the SSRF guard requires `https` and blocks internal addresses. |

## Email notifications

Optional and **env-gated** — when `SMTP_HOST` is unset, email is a no-op (in-app notifications still work). When configured, participants get a debounced activity digest per document; each user can toggle it off under **Settings → Notifications**.

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | SMTP transport (absence disables email). |
| `EMAIL_FROM` | From address on outgoing mail. |
| `EMAIL_DEBOUNCE_MS` | Coalescing window for digests (default `45000`). |

Delivery rides the same durable **outbox** worker as webhooks; tune it with `OUTBOX_POLL_MS`, `OUTBOX_BACKOFF_MS`, `OUTBOX_MAX_ATTEMPTS`, and `OUTBOX_WORKER_AUTOSTART` (see [`.env.example`](.env.example) for all variables and defaults).

## Stack

Next.js 16 (App Router, React 19) · Prisma 7 + SQLite (WAL, better-sqlite3 adapter) · better-auth (email/password + generic OIDC) · CodeMirror 6 · react-markdown + remark-gfm · Tailwind CSS 4 · Server-Sent Events · nodemailer · a durable in-process outbox worker. Packaged as a single standalone container.

## Project layout

```
app/            Next.js App Router — pages (app/app/*) + API routes (app/api/*)
components/     React UI (editor, document view, comment sidebar, inbox) + ui/ primitives
lib/            Pure libs → services → helpers: documents, annotations, anchoring,
                reviews, feedback, versions, diff, notifications, email, outbox,
                webhooks, crypto, authz, tokens, auth, theme, db, SSE events
prisma/         Schema (User, Session, Account, Document, DocumentVersion, Annotation,
                Comment, Review, Notification, DocumentParticipant, ApiToken, Webhook,
                OutboxJob, …) + migrations
tests/          Vitest unit tests + Playwright e2e (auth, review, versioning, nav)
docs/           Design specs, phase plans, security audit, ADRs, build status
.claude/        Agent slash commands (/push-plan, /pull-feedback)
```

Architecture convention: **pure libs → services → thin routes → client**, with shared value-sets in `lib/enums.ts`.

## Testing

```bash
pnpm test:unit            # Vitest unit tests
pnpm test:e2e             # Playwright e2e (free port 3000 first; webServer rebuilds)
pnpm lint                 # ESLint
```

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Timo Hankamer.
