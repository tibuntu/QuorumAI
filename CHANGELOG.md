# Changelog

## [0.4.0](https://github.com/tibuntu/consensum/compare/v0.3.1...v0.4.0) (2026-06-15)


### Features

* auto-proceed plan review via ExitPlanMode hook + installer ([bc05d9b](https://github.com/tibuntu/consensum/commit/bc05d9b55c3732a8b9f827633b00fe9c2232da85))
* rename product from Quorum AI to Consensum ([7737ff9](https://github.com/tibuntu/consensum/commit/7737ff9ed5feaf8a8d10f79d17a89f6ea1fa14c9))
* **ui:** merge theme buttons into a single cycling toggle ([cd2c9a8](https://github.com/tibuntu/consensum/commit/cd2c9a85fe5d5e3886e78bc8452e472ab8f31f61))


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.18 ([0fdb012](https://github.com/tibuntu/consensum/commit/0fdb012d666e64d684b0677141eca005bd55ae30))

## [0.3.1](https://github.com/tibuntu/QuorumAI/compare/v0.3.0...v0.3.1) (2026-06-14)


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.16 ([8f29ff9](https://github.com/tibuntu/QuorumAI/commit/8f29ff9b2ce14d010a8287fee620e7dfe464b6ef))
* **deps:** update better-auth monorepo to v1.6.17 ([ce540e4](https://github.com/tibuntu/QuorumAI/commit/ce540e477247848cce0c2d4618db6958057129fc))
* **deps:** update nextjs monorepo to v16.2.9 ([572443c](https://github.com/tibuntu/QuorumAI/commit/572443cf5a7130be79d3612ec159103b5eabe5ee))

## [0.3.0](https://github.com/tibuntu/QuorumAI/compare/v0.2.0...v0.3.0) (2026-06-11)

### Features

* **UI polish** — a fresh 6-pillar visual audit took the app from 17/24 to 23/24: a token-driven dark theme for the CodeMirror editor, editor line-wrapping, violet-accented form controls, a legible dark-mode task-list checkbox, demotion of a duplicate leading H1, theme-aware presence colors, per-column version-diff headers, session-control tooltips, and a cursor→person legend.
* **Granular notification preferences** — the two global on/off switches are replaced by a per-type × per-channel matrix (comment / review / version / resolve × in-app / email / desktop); `resolve` stays non-emailable. Preferences live in a new `notificationPrefs` column (existing settings migrated automatically), and both server dispatch and desktop firing honor them per type.
* **Configurable approval quorums** — a document owner can require up to 10 approvals before a plan is marked Approved, set at creation or changed later via owner-only settings endpoints (web + machine API). The review panel shows "N of M approvals" progress, the feedback contract reports the threshold and current count, and document state recomputes immediately when the threshold changes.

### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.15 ([bdc6565](https://github.com/tibuntu/QuorumAI/commit/bdc6565c4df1a5cf67e4b534cd956eb10347a3df))

## [0.2.0](https://github.com/tibuntu/QuorumAI/compare/v0.1.0...v0.2.0) (2026-06-10)

Real-time collaboration: multiple reviewers can now work in the same document together and see each other live.

### Features

* **Live presence** — see who else is in a document via an avatar stack, backed by heartbeats with automatic TTL expiry and a roster replayed on connect.
* **Shared text selections** — other participants' selections render as tinted, per-user highlights in real time.
* **Live cursors** — collaborators' cursor positions are broadcast and rendered as a moving overlay.
* **Review sessions** — start, join, leave, and end a shared review session led by a designated leader; the session auto-ends when the leader drops, and reconnecting replays the active session.
* **Follow-the-leader scroll** — followers' viewports track the leader's scroll position, automatically detaching when a follower scrolls manually and resuming on demand.

### Bug Fixes

* Hardened the presence beacon against out-of-range selection offsets and unparseable request bodies ([b4e78a8](https://github.com/tibuntu/QuorumAI/commit/b4e78a8cd2a12486fd47d22463604da61624a054)).
