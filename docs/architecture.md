# Architecture

## Stack

Next.js 16 (App Router, React 19) · Prisma 7 + SQLite (WAL, better-sqlite3 adapter) with
optional PostgreSQL for multi-replica deployments · better-auth (email/password + generic
OIDC) · CodeMirror 6 · react-markdown + remark-gfm · Tailwind CSS 4 · Server-Sent Events ·
nodemailer · a durable in-process outbox worker. Packaged as a single standalone container.

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
scripts/        install.sh and tooling
docker/         Container build/runtime support files
tests/          Vitest unit tests + Playwright e2e (auth, review, versioning, nav)
dist/claude/    Shipped Claude Code integration — slash commands + the ExitPlanMode hook
                (installed via scripts/install.sh)
docs/adr/       Architecture Decision Records (ADRs)
```

## Layering convention

The codebase follows a strict layering: **pure libs → services → thin routes → client**.

- Business logic belongs in `lib/` (pure, then service helpers), not in route handlers.
- API routes in `app/api/*` stay thin — parse, authorize, delegate, respond.
- Shared value-sets live in `lib/enums.ts`.

See the [Architecture Decision Records](adr/) for the rationale behind key design and
security decisions.
