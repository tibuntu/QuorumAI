# Changelog

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
