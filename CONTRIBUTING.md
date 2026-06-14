# Contributing to Quorum AI

Thanks for your interest in improving Quorum AI! This guide covers how to get a local
environment running, the conventions we follow, and how to submit changes.

## Getting started

Quorum AI is a Next.js app with an embedded SQLite database — no external services are
required for local development. The repo uses **pnpm v11**.

```bash
cp .env.example .env      # then set AUTH_SECRET to a 32+ char random string
CI=true pnpm install      # CI=true required for pnpm v11
pnpm db:migrate           # apply migrations to ./data/app.db
pnpm dev                  # → http://localhost:3000
```

The `.env` file is gitignored — never commit secrets. `.env.example` documents every
supported variable; see the [README](README.md) for the optional integrations (OIDC SSO,
SMTP email, outbound webhooks).

> If you pull changes that touch the Prisma schema or migrations, re-run
> `pnpm db:migrate` and regenerate the client (`pnpm prisma generate`) — the generated
> client and the local database are not tracked.

## Tests, lint, and types

Please make sure the relevant checks pass before opening a pull request:

```bash
pnpm test:unit            # Vitest unit tests
pnpm test:e2e             # Playwright e2e (free port 3000 first; webServer rebuilds)
pnpm lint                 # ESLint
```

New behaviour should come with tests. Unit tests live under `tests/` next to the existing
Vitest suites; user-facing flows are covered by Playwright e2e (auth, review, versioning,
navigation).

## Architecture conventions

The codebase follows a strict layering: **pure libs → services → thin routes → client**.

- Business logic belongs in `lib/` (pure, then service helpers), not in route handlers.
- API routes in `app/api/*` stay thin — parse, authorize, delegate, respond.
- Shared value-sets live in `lib/enums.ts`.

See the [Project layout](README.md#project-layout) section of the README for where things
go.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/). The type prefix
drives automated releases, so please use one of:

```
feat:     a new feature
fix:      a bug fix
chore:    tooling, deps, housekeeping
docs:     documentation only
test:     tests only
refactor: code change that neither fixes a bug nor adds a feature
```

Keep the subject in the imperative mood and under ~72 characters, e.g.
`feat(webhooks): add per-webhook delivery log`.

## Pull requests

1. Branch off `main`.
2. Make your change with focused, atomic commits.
3. Ensure tests, lint, and the build pass locally.
4. Open a pull request describing **what** changed and **why**. Link any related issue.

## Reporting bugs and requesting features

Please use the project's GitHub issue tracker. For bug reports, include reproduction steps,
expected vs. actual behaviour, and your environment (OS, Node/pnpm version, deployment
mode). For security-sensitive reports, please disclose privately rather than opening a
public issue.

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE), the same license that covers this project.
