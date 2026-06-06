---
milestone: M3
phase: P6
slug: quorum-ai-m3-p6-oidc
title: Generic OIDC login
status: design-draft
created: 2026-06-06
related:
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-roadmap.md
adr_candidate: true
---

# M3 / P6 — Generic OIDC Login

> Adds single-sign-on via one configurable, generic OIDC provider (Keycloak /
> Authentik / Azure AD / Auth0), alongside the existing email+password. Env-gated and
> hidden when unconfigured, mirroring the SMTP gate. The data model already supports
> it — this is mostly configuration + a login button + linking policy.

## Problem

Login is email+password only (`emailAndPassword` in `lib/auth.ts`). Teams that run an
IdP can't bring their existing identities, and there's no SSO story — OIDC was the most
requested deferred item from the M2 roadmap.

## Goals

- One generic OIDC provider wired into better-auth, gated by
  `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` (no-op + button hidden when
  unset).
- "Sign in with SSO" on the login page; account linking via the existing `Account`
  model — **no schema change**.
- `.env.example` + README updated.

## Non-goals (deferred to M4+)

Multiple simultaneous OIDC providers; named social buttons (Google/GitHub) as distinct
providers; enforced-SSO mode (disable password login); SCIM / org just-in-time
provisioning; role mapping from IdP claims (new users get the default `member` role).

---

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Provider style | **One generic OIDC provider** via better-auth's generic OAuth/OIDC support, configured from env. Self-host-friendly (Keycloak/Authentik) and works with Azure/Auth0. |
| D2 | Coexistence | **Alongside email+password** — both enabled. Password stays the default; SSO is additive. |
| D3 | Gating | **Env-gated like SMTP:** if the three OIDC envs are unset, the provider isn't registered and the login button is hidden. Zero config-burden for the default deploy. |
| D4 | Account linking | **Link by verified email.** If an OIDC sign-in's verified email matches an existing user, link a new `Account{providerId:"oidc"}` row to that user (existing `@@unique([accountId, providerId])` supports it). Unmatched → create a new user with the default `member` role. |
| D5 | Trust | Only link on an **email the IdP marks verified**; otherwise create-new (avoid account-takeover via unverified-email collision). Confirm better-auth's linking config enforces this; set explicitly. |
| D6 | ADR | **Draft an ADR** (auth-architecture decision: generic-OIDC-alongside-password + email-linking policy) before/at implementation — flagged `adr_candidate: true`. |

---

## Configuration surface

`lib/auth.ts` — register the provider conditionally:

```ts
const oidcConfigured = !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET);
// add the generic OIDC provider to the betterAuth config only when oidcConfigured,
// with account linking restricted to verified-email matches (D4/D5).
```

`lib/auth-client.ts` exposes the social/OIDC sign-in call; `app/login/page.tsx` renders
the "Sign in with SSO" button **only when** a public flag (e.g. `NEXT_PUBLIC_OIDC_ENABLED`)
is set, so the client knows whether to show it without leaking secrets.

`.env.example` gains:
```
# Optional SSO (generic OIDC). Unset = password-only.
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
NEXT_PUBLIC_OIDC_ENABLED=
```

No `prisma/schema.prisma` change — `Account` already stores `providerId`, `idToken`,
`accessToken`, `refreshToken`, `scope`, with `@@unique([accountId, providerId])`.

---

## Testing strategy

### Unit / config
- Provider registered iff the three envs are set; absent → not registered, button flag
  off.
- Linking policy: verified-email match links to existing user (new `Account` row, same
  `userId`); unverified email → new user, no link.

### E2e
- With OIDC env set (mock IdP / test issuer): SSO button visible; sign-in creates a
  session and a user with `role=member`; second SSO sign-in reuses the same user.
- Existing password user with matching verified email signs in via SSO → same account,
  not a duplicate.
- With OIDC env unset: button hidden; password login unaffected.

---

## Execution notes

Independent of other phases. Verify better-auth's exact generic-OIDC plugin API + its
account-linking/`trustedProviders` config against the installed `better-auth@1.6.x`
during the brainstorm (the dependency is the source of truth, not this sketch). Draft
the ADR (`adr` skill). Isolated worktree; `CI=true`; rebase onto `main`.
