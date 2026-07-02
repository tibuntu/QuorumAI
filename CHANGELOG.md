# Changelog

## [0.11.1](https://github.com/tibuntu/consensum/compare/v0.11.0...v0.11.1) (2026-07-02)


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.23 ([061785b](https://github.com/tibuntu/consensum/commit/061785bcd8d090f7cec589b814d4fcd2a46add17))
* **deps:** update dev dependencies to v4.3.2 ([d2ece3b](https://github.com/tibuntu/consensum/commit/d2ece3bfddbb0c490d72aa5137df4ecae6bf81ed))

## [0.11.0](https://github.com/tibuntu/consensum/compare/v0.10.0...v0.11.0) (2026-06-28)


### Features

* **auth:** DB-backed rate-limit storage + provider-matched adapter ([47366d2](https://github.com/tibuntu/consensum/commit/47366d2e3883e40a6496a3d90b4e0daf939fc1fa))
* **db:** dual-provider Prisma scaffolding (sqlite + postgresql) ([a1509e4](https://github.com/tibuntu/consensum/commit/a1509e46363a72958eb673006322b9febc20b38e))
* **db:** select Prisma driver adapter by DATABASE_URL (pg vs sqlite) ([eb2c0df](https://github.com/tibuntu/consensum/commit/eb2c0df62f566eddead3c184fe74c2ba56db9c58))
* **deploy:** multi-replica docker-compose reference (postgres + 2 replicas) ([23ce0b8](https://github.com/tibuntu/consensum/commit/23ce0b8de53aeaa663c053057f72c2d28378d994))
* **docker:** build and run the image on PostgreSQL (build-arg + gated migrate) ([d8aee94](https://github.com/tibuntu/consensum/commit/d8aee942e55673db5e6848685135ee7a01196c12))
* **events:** cross-replica event bus via Postgres LISTEN/NOTIFY ([59d7a0b](https://github.com/tibuntu/consensum/commit/59d7a0bef249e581004b662070cf5d0b195829b6))
* **outbox:** atomic claiming + lease-based recovery for multi-replica ([0ba07b9](https://github.com/tibuntu/consensum/commit/0ba07b9fef3b4456220b0fb51135fe863cee1ac0))
* **presence:** converge presence + review-session across replicas ([b302add](https://github.com/tibuntu/consensum/commit/b302addb47582835de9b963beedf75a0c0e7ac9e))


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.21 ([15eee5a](https://github.com/tibuntu/consensum/commit/15eee5af0fb785d37f49b1850b3f41af81f52d61))

## [0.10.0](https://github.com/tibuntu/consensum/compare/v0.9.0...v0.10.0) (2026-06-26)


### Features

* **agent-api:** harden the agent review-loop contract ([a2a5d42](https://github.com/tibuntu/consensum/commit/a2a5d4275f5878d3a6ae2fd5e90249eb4be480f7))


### Bug Fixes

* **deps:** dedupe @codemirror/state to a single version ([7a72afa](https://github.com/tibuntu/consensum/commit/7a72afaebc92f7b6feac103e39e7d6bd5127980e))

## [0.9.0](https://github.com/tibuntu/consensum/compare/v0.8.0...v0.9.0) (2026-06-26)


### Features

* **ui:** UI overhaul — identity, accessibility, and review workflow ([b8ad15c](https://github.com/tibuntu/consensum/commit/b8ad15c8a1aaffcc077dc7088dc7d599eaea5f8e))


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.20 ([307c857](https://github.com/tibuntu/consensum/commit/307c8579cfafa53564a3fb24d3026dea5b15ad49))
* **deps:** update dev dependencies ([8425928](https://github.com/tibuntu/consensum/commit/84259280bee7e3fb68d5357e3db37f753489b989))
* **deps:** update pnpm to v11.9.0 ([740c06d](https://github.com/tibuntu/consensum/commit/740c06dc63a679f8bb11a09a00854363625301a8))
* **docker:** drop npm from the runtime image to clear a Trivy HIGH ([137a4e0](https://github.com/tibuntu/consensum/commit/137a4e06935619e37f378dd5953e3c48a3321acd))

## [0.8.0](https://github.com/tibuntu/consensum/compare/v0.7.0...v0.8.0) (2026-06-20)


### Features

* **auth:** gate self-service registration behind an email allowlist ([75df860](https://github.com/tibuntu/consensum/commit/75df86004003973d66b76cb64bf78af9aef02144))

## [0.7.0](https://github.com/tibuntu/consensum/compare/v0.6.1...v0.7.0) (2026-06-20)


### Features

* **api:** expose anchor offsets and context on feedback threads ([2a291a4](https://github.com/tibuntu/consensum/commit/2a291a43a788dd12bda421b9b13ab8f1d93a921b))
* **api:** expose comment/review ids, timestamps, and reviewed version in feedback API ([6d45161](https://github.com/tibuntu/consensum/commit/6d4516183e43b049b70d3804fbfffd99097b3db5))


### Bug Fixes

* **api:** expose suggestion replacement text in feedback API ([3519f91](https://github.com/tibuntu/consensum/commit/3519f91acd08db82188013121d52988b0117f1e8))

## [0.6.1](https://github.com/tibuntu/consensum/compare/v0.6.0...v0.6.1) (2026-06-19)


### Bug Fixes

* **ci:** properly extract image metadate via jq ([feebf2b](https://github.com/tibuntu/consensum/commit/feebf2bed4005253dc88a92f5a3e9803be428360))

## [0.6.0](https://github.com/tibuntu/consensum/compare/v0.5.0...v0.6.0) (2026-06-19)


### Features

* **ci:** build ARM docker image ([cf28b45](https://github.com/tibuntu/consensum/commit/cf28b4569f2d5334941fd7916f8d739f777b2ad2))

## [0.5.0](https://github.com/tibuntu/consensum/compare/v0.4.1...v0.5.0) (2026-06-19)


### Features

* **documents:** add copy-to-clipboard button for plan markdown ([793d860](https://github.com/tibuntu/consensum/commit/793d860c9a0c3240842db5cb56f02523c4b115eb))


### Bug Fixes

* **deps:** pin better-call override to 1.3.6 for better-auth compat ([162dbad](https://github.com/tibuntu/consensum/commit/162dbad74159117ee4880e0a436b0a3fb0b0e67d))
* **deps:** update better-auth monorepo to v1.6.19 ([b8e8ad3](https://github.com/tibuntu/consensum/commit/b8e8ad3601a19406b546eb7c650d8d5b596d052d))
* **deps:** update dependency nodemailer to v9 ([92d4c49](https://github.com/tibuntu/consensum/commit/92d4c49956c8d0c5bfeea30deff3ac584a67e21f))

## [0.4.1](https://github.com/tibuntu/consensum/compare/v0.4.0...v0.4.1) (2026-06-15)


### Bug Fixes

* **docker:** bake matching Prisma engine so migrate works on read-only K8s FS ([4b3d0ec](https://github.com/tibuntu/consensum/commit/4b3d0ec7c1d73827054bd6f44faa70de136508e1))
* **docker:** ship prod-only distroless image to drop dev-dep CVEs ([0250868](https://github.com/tibuntu/consensum/commit/025086890cba041723966aeea239ff97d041f3f8))

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
