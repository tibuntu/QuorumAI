# Quorum AI · M2/P2 — Email Notifications (Design)

**Status:** Approved design, ready for implementation plan
**Milestone/Phase:** M2 · P2
**Depends on:** M2/P1 Authorization (participant model) — merged
**Date:** 2026-06-06

## Context

M1 shipped the hero loop and in-app notifications; M2/P1 closed the authorization gap and
re-based notifications on the `DocumentParticipant` table. But review is asynchronous, and
today a reviewer only learns a plan is waiting if they happen to open the app. **Async review
is functionally dead without out-of-app delivery.** P2 adds transactional email so the people
on a document hear about activity where they already are.

P2 is deliberately small and rides entirely on P1's participant model: it adds a delivery
sink alongside the existing in-app inbox, with a single user-facing on/off preference. No
digests, no granular per-event preferences, no new fan-out logic — those are deferred.

## Locked decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Delivery mechanism | **nodemailer (generic SMTP)**, env-gated | Provider-agnostic; "transactional SMTP" per roadmap. No-op when `SMTP_*` env unset → dev/test/CI stay silent. |
| D2 | Preference default | **Opt-out (default ON)**, existing users backfilled `true` | Maximizes the "did anyone see my plan?" fix; only fires when SMTP is configured anyway. |
| D3 | Body format | **Lightweight HTML + plaintext fallback** | Readable, branded button to the doc; plaintext for non-HTML clients. |
| D4 | Send timing | **Per-event, deduped** (debounce window per user+doc) | No digest, but coalesces a burst on one doc to one email. |
| D5 | Which events email | **comment, review, version** | Per roadmap. `resolve` stays in-app only (low signal). |
| D6 | Delivery guarantee | **Best-effort, fire-and-forget** | Never blocks or fails the originating request; matches existing `notifyParticipants(...).catch(() => {})` posture. A buffered email lost on process restart is acceptable. |

## Architecture

New units, each single-purpose:

### `lib/email.ts` — transport
- `isEmailConfigured(): boolean` — true when required `SMTP_*` env present.
- `sendMail({ to, subject, html, text }): Promise<void>` — lazily builds a **singleton**
  nodemailer transport from env; **returns early (no-op)** when not configured.
- Env vars (all optional; absence = feature off): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_SECURE` (bool), `EMAIL_FROM`. Add to `.env.example`.
- Test seam: when `EMAIL_TRANSPORT=json` (or in test env), use nodemailer `jsonTransport`
  so sends are captured, not delivered.

### `lib/email-templates.ts` — pure rendering
- `renderActivityEmail({ recipientName, docTitle, docUrl, events }): { subject, html, text }`.
- `events` is the coalesced list (e.g. `[{type:"comment", actorName, count}]`); subject and
  body summarize them ("Alice and 1 other — 3 new comments on *Plan title*").
- `docUrl` is absolute: `${process.env.BETTER_AUTH_URL}/app/documents/${id}`.
- Pure functions, no I/O — unit-tested directly.

### `lib/email-digest.ts` — dedup buffer
- Module-level `Map<"${userId}:${documentId}", { events: Event[]; timer }>`.
- `enqueueEmailEvent(userId, documentId, type, actorName)`:
  - Returns immediately (no buffering) if `!isEmailConfigured()`.
  - Appends the event and sets/resets a debounce timer (`EMAIL_DEBOUNCE_MS`, default ~45s).
  - On fire: load recipient (name/email) + doc title, build via `renderActivityEmail`,
    `sendMail`, then delete the map entry. All wrapped in `.catch(() => {})`.
- Single Node process per container makes the in-memory map safe. Configurable window keeps
  tests fast (set to a few ms).

### Schema
- Add to `User`: `emailNotifications Boolean @default(true)`.
- Migration backfills existing rows to `true` (default covers new rows).
- Follow [[quorum-prisma-after-pull]] when applying: `prisma migrate deploy` + `generate`,
  restart dev server (client is gitignored, DB is per-checkout).

### Hook point — extend the single fan-out site
`lib/notifications.ts :: notifyParticipants(documentId, actorId, type)`:
- Keep creating in-app `Notification` rows unchanged.
- For email-eligible types (`comment | review | version`), additionally:
  - resolve recipient set (participants minus actor) — already computed,
  - fetch each recipient's `emailNotifications` flag and the actor's `name`,
  - for recipients with the flag on, call `enqueueEmailEvent(...)`.
- No new call sites: every event already routes through `notifyParticipants` (annotations,
  reviews, versions). `resolve` simply isn't enqueued.

### Settings UI
- `app/app/settings/notifications/page.tsx` (server) — reads `emailNotifications` for the
  session user, renders `components/NotificationSettings.tsx`.
- `components/NotificationSettings.tsx` (client) — single toggle; `PATCH`es the API.
- `app/api/settings/notifications/route.ts` — `PATCH { emailNotifications: boolean }`,
  session-guarded, updates the user row. Mirrors the `tokens` settings pattern.
- `app/app/settings/layout.tsx` — small settings sub-nav (**Tokens** | **Notifications**)
  so both pages are reachable. Closes the long-standing "no Settings nav" gap
  ([[quorum-deferred-ui-work]] item 3); the header "Settings" link in `components/AppNav.tsx`
  can point at `/app/settings` (or keep `/tokens`) with the sub-nav handling the rest.

## Data flow

```
comment / review / version event
  → notifyParticipants(docId, actorId, type)          // lib/notifications.ts (existing site)
      → create in-app Notifications                    // unchanged
      → recipients = participants − actor
      → for r in recipients where r.emailNotifications: // new
            enqueueEmailEvent(r.id, docId, type, actorName)
                → (no-op if SMTP unset)
                → debounce window per (user, doc)
                → renderActivityEmail → sendMail        // best-effort
```

## Error handling

- Every email path is best-effort and isolated with `.catch(() => {})`; a mailer failure
  never propagates to the request that triggered it.
- Unconfigured SMTP short-circuits at `enqueueEmailEvent` (nothing buffered, nothing sent).
- No retries/queue in M2 (deferred).

## Testing

**Unit**
- `email.ts`: `isEmailConfigured` true/false by env; `sendMail` no-ops when unconfigured.
- `email-templates.ts`: subject/body contain doc title + absolute `BETTER_AUTH_URL` link;
  single vs multi-event and single vs multi-actor phrasing.
- `email-digest.ts`: N events on one (user, doc) within the window → **one** composed email
  (fake timers / tiny `EMAIL_DEBOUNCE_MS`); separate docs/users → separate emails;
  no-op when SMTP unset.
- `notifications.ts`: opt-out recipient (`emailNotifications=false`) is excluded; actor is
  excluded; `resolve` produces no email.

**Integration/e2e**
- With `EMAIL_TRANSPORT=json` + tiny debounce: a posted comment yields exactly one captured
  email to the other participant; toggling the preference off suppresses it.

## Out of scope (deferred)

- Email digests / scheduled summaries; granular per-event-type preferences.
- Retry queue / durable outbox; provider-API delivery (SendGrid/Resend).
- `resolve` emails; verification-of-email flows beyond what better-auth already provides.

## Files

**New:** `lib/email.ts`, `lib/email-templates.ts`, `lib/email-digest.ts`,
`app/app/settings/notifications/page.tsx`, `components/NotificationSettings.tsx`,
`app/api/settings/notifications/route.ts`, `app/app/settings/layout.tsx`,
plus unit tests under `tests/unit/` and an integration case under `tests/e2e/`.

**Modified:** `prisma/schema.prisma` (+ migration), `lib/notifications.ts` (enqueue emails),
`components/AppNav.tsx` (settings link target), `.env.example` (SMTP vars).
