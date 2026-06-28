# Operations

Deploying, securing, and configuring a Consensum instance. For the exhaustive list of
environment variables and their defaults, see [`.env.example`](../.env.example) — it is the
source of truth and the sections below describe the concepts, not every knob.

## Deployment

### Single container (default)

Consensum runs as one container with an embedded SQLite database (WAL) — no external
services. Data persists in a named volume.

```bash
AUTH_SECRET=$(openssl rand -base64 32) docker compose up
# → http://localhost:3000
```

### Multi-replica (PostgreSQL)

For horizontal scaling, run Postgres with two or more active-active app replicas behind a
reverse proxy. A reference Compose file ships in the repo:

```bash
AUTH_SECRET="$(openssl rand -base64 32)" docker compose -f docker-compose.postgres.yml up --build
# → http://localhost:8080
```

This mirrors a Kubernetes Deployment (2+ pods) plus a one-shot migration Job. Set
`DB_PROVIDER=postgres` with a `postgresql://` `DATABASE_URL`, and `RUN_MIGRATIONS_ON_START=false`
so a dedicated migration step runs before the replicas start.

### Health checks

- `GET /healthz` — liveness (process up; no dependencies).
- `GET /readyz` — readiness (returns 503 if the database is unreachable).

The Docker image and Compose service both ship a healthcheck that polls `/readyz`.
Kubernetes example:

```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 3000 }
  periodSeconds: 10
readinessProbe:
  httpGet: { path: /readyz, port: 3000 }
  periodSeconds: 10
startupProbe:
  httpGet: { path: /readyz, port: 3000 }
  failureThreshold: 30
  periodSeconds: 2
```

## First run & registration

Self-service registration is **fail-closed**. `REGISTRATION_ALLOWLIST` is empty by default,
which means registration is **disabled** — a fresh instance has no way to create the first
account until you set it. Each comma-separated entry is an exact email
(`alice@corp.com`), a bare domain (`corp.com` = anyone `@corp.com`), or `*` to allow all
emails.

```bash
REGISTRATION_ALLOWLIST=you@corp.com   # allow your first account
# or REGISTRATION_ALLOWLIST=corp.com  # anyone at your domain
# or REGISTRATION_ALLOWLIST=*         # fully open registration
```

Set `TRUSTED_ORIGINS` (comma-separated) to add CSRF-trusted origins beyond `BASE_URL`.
`DISABLE_RATE_LIMIT` turns off auth rate limiting for test/dev only.

## Single sign-on (optional OIDC)

Consensum supports one generic OIDC provider (Keycloak, Authentik, Azure AD, Auth0, …)
alongside email+password. It is off by default. Set:

| Variable | Purpose |
|----------|---------|
| `OIDC_ISSUER` | Issuer URL; discovery is fetched from `<issuer>/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | OAuth client credentials from your IdP |
| `NEXT_PUBLIC_OIDC_ENABLED` | `true` renders the "Sign in with SSO" button — set it **only together with** the three `OIDC_*` vars, since the flag merely controls the button and enabling it alone shows one whose sign-in 404s |

Configure your IdP's redirect URI to `<BASE_URL>/api/auth/oauth2/callback/oidc`.

**Account linking.** An SSO sign-in whose email the IdP marks *verified* is linked to an
existing user with that email; otherwise a new `member` user is created.

**Signup under SSO.** When OIDC is configured, self-service password registration is
disabled (identity provisioning belongs to the IdP); existing password **login** still
works. See
[`ADR-Security-000-generic-oidc-sso-alongside-password.md`](adr/ADR-Security-000-generic-oidc-sso-alongside-password.md)
for the rationale.

## Outbound webhooks

Register a webhook (owner-scoped, optionally narrowed to a single plan) in **Settings** to
be notified on review events — the server-context complement to `/feedback/wait`. Events:
`version.created`, `review.updated`, `decision.changed`, `comment.created`.

Each delivery is a JSON `POST` signed with **HMAC-SHA256** (`X-Consensum-Signature: sha256=…`,
`X-Consensum-Timestamp`, `X-Consensum-Event`). Deliveries ride the durable outbox worker
with retry/backoff and dead-lettering; a per-webhook delivery log surfaces failures.

| Variable | Purpose |
|----------|---------|
| `WEBHOOK_SECRET_KEY` | App key that encrypts stored signing secrets at rest (AES-256-GCM). **Recommended in production** — without it secrets are stored as plaintext (`v0:` marker) so dev/CI can run keyless. |
| `WEBHOOK_ALLOW_INSECURE` | Dev-only: allow `http://` / loopback / link-local targets. In production the SSRF guard requires `https` and blocks internal addresses. |

## Email notifications

Optional and **env-gated** — when `SMTP_HOST` is unset, email is a no-op (in-app
notifications still work). When configured, participants get a debounced activity digest
per document; each user can toggle it off under **Settings → Notifications**.

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | SMTP transport (absence disables email). |
| `EMAIL_FROM` | From address on outgoing mail. |
| `EMAIL_DEBOUNCE_MS` | Coalescing window for digests (default `45000`). |

## Outbox worker

Both email digests and webhook deliveries ride one durable in-process outbox worker. Tune
it with `OUTBOX_WORKER_AUTOSTART`, `OUTBOX_POLL_MS`, `OUTBOX_BACKOFF_MS`,
`OUTBOX_MAX_ATTEMPTS`, `OUTBOX_BATCH`, and `OUTBOX_LEASE_MS` — see
[`.env.example`](../.env.example) for defaults.

## Document editing UI

`EDIT_UI_ENABLED` (default on) — set to `false` to hide the in-app document Edit button.
The `PATCH /api/documents/[id]` edit endpoint is **not** gated; only the UI.
