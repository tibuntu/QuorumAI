---
milestone: M3
phase: P6
slug: quorum-ai-m3-p6-oidc
title: Generic OIDC login
status: designed
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
| D4 | Account linking | **Link by IdP-verified email.** If an OIDC sign-in's verified email matches an existing user, link a new `Account{providerId:"oidc"}` row to that user (existing `@@unique([accountId, providerId])` supports it). Unmatched → create a new user with the default `member` role. |
| D5 | Trust | Only link on an **email the IdP marks verified**. Enforced by keeping `"oidc"` **out of `trustedProviders`** so better-auth requires `oidcEmailVerified` before linking. **`account.accountLinking.requireLocalEmailVerified` must be set `false`** — Quorum has no email-verification flow, so every local password user has `emailVerified=false`; with the better-auth default (`true`) auto-linking would *never* fire and a colliding-email SSO sign-in would error with `"account not linked"`. Verified in `better-auth@1.6.14` `dist/oauth2/link-account.mjs`. |
| D5a | Takeover mitigation | Setting `requireLocalEmailVerified:false` reopens a pre-registration takeover vector (registration is open: an attacker pre-registers an unverified `victim@corp.com`, the real victim's later SSO login links into it). **Close it by gating self-service password signup on `oidcConfigured`** (`emailAndPassword.disableSignUp = oidcConfigured`) plus a `/register` UI guard. Password **login** for existing accounts is unaffected; under SSO, identity provisioning belongs to the IdP. Default (non-OIDC) deploys keep open signup. |
| D6 | ADR | **Draft an ADR** (auth-architecture decision: generic-OIDC-alongside-password + the D5/D5a linking-and-signup policy) before implementation — flagged `adr_candidate: true`. |

---

## Configuration surface

`lib/auth.ts` — register the provider conditionally (the `genericOAuth` plugin from
`better-auth/plugins`; `oidc-provider` is the *opposite* — for *being* an IdP):

```ts
import { genericOAuth } from "better-auth/plugins";

const oidcConfigured = !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET);

export const auth = betterAuth({
  // …existing…
  emailAndPassword: { enabled: true, disableSignUp: oidcConfigured }, // D5a: login stays, signup off under SSO
  account: {
    accountLinking: {
      enabled: true,
      requireLocalEmailVerified: false, // D5: Quorum never verifies local email
      // "oidc" intentionally NOT in trustedProviders → IdP email MUST be verified to link
    },
  },
  plugins: [
    ...(oidcConfigured
      ? [genericOAuth({ config: [{
          providerId: "oidc",
          discoveryUrl: `${process.env.OIDC_ISSUER!.replace(/\/$/, "")}/.well-known/openid-configuration`,
          clientId: process.env.OIDC_CLIENT_ID!,
          clientSecret: process.env.OIDC_CLIENT_SECRET!,
          scopes: ["openid", "email", "profile"],
          pkce: true,
        }] })]
      : []),
    nextCookies(), // stays last
  ],
});
```

`lib/auth-client.ts` adds `genericOAuthClient()` to `createAuthClient`, exposing
`signIn.oauth2({ providerId: "oidc", callbackURL: "/" })`. `app/login/page.tsx` renders
the "Sign in with SSO" button **only when** `NEXT_PUBLIC_OIDC_ENABLED` is set (no secret
leak). `app/register/page.tsx` hides/redirects the signup form under the same flag,
matching the server-side `disableSignUp` gate (D5a).

`.env.example` gains:
```
# Optional SSO (generic OIDC). Unset = password-only.
# When set, self-service password signup is disabled (D5a); password login still works.
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
- Existing password user with matching IdP-verified email signs in via SSO → same
  account, not a duplicate (requires `requireLocalEmailVerified:false`, D5).
- With OIDC env set: self-service password signup is disabled — `/register` redirects
  and `signUp.email` is rejected server-side (D5a). Password **login** still works.
- With OIDC env unset: button hidden; password login + signup unaffected.

---

## Execution notes

Independent of other phases. Verify better-auth's exact generic-OIDC plugin API + its
account-linking/`trustedProviders` config against the installed `better-auth@1.6.x`
during the brainstorm (the dependency is the source of truth, not this sketch). Draft
the ADR (`adr` skill). Isolated worktree; `CI=true`; rebase onto `main`.
