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

🚧 Early development. Building **M1 (MVP)** — the end-to-end hero loop in a single Docker container. See [`docs/superpowers/specs/2026-06-04-quorum-ai-design.md`](docs/superpowers/specs/2026-06-04-quorum-ai-design.md) for the full design.

## Self-hosting (target)

Quorum AI is designed to run as **one Docker container** with an embedded SQLite database — no external services required.

```bash
docker compose up   # → http://localhost:3000   (data persisted in a named volume)
```

_(Quickstart will be fleshed out as M1 lands.)_

## Stack

Next.js 16 · Prisma + SQLite (WAL) · better-auth · CodeMirror 6 · react-markdown · Server-Sent Events. Packaged as a single standalone container.
