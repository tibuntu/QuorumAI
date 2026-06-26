#!/usr/bin/env node
// Consensum auto-proceed hook for Claude Code's `ExitPlanMode` tool.
//
// Registered as a `PermissionRequest` hook (see .claude/settings.json). When the
// agent finishes planning and calls ExitPlanMode, this script BLOCKS inside that
// tool call: it pushes the plan to Consensum, waits for the team's verdict, then
//   - APPROVED          -> returns `allow`  (Claude exits plan mode and implements)
//   - CHANGES_REQUESTED -> returns `deny` + a feedback digest (Claude revises and
//                          re-presents the plan, which re-fires this hook -> the loop)
//
// FAIL-CLOSED: if the hook is installed but cannot complete a review — no token,
// push failure, plan vanished, or an unexpected error — it returns `deny` with a
// clear, in-band message rather than silently proceeding with an un-reviewed plan.
// To deliberately bypass review (e.g. Consensum not used on this project), set
// CONSENSUM_SKIP=1 (or remove the hook). State is scoped per Claude Code
// `session_id`, so a fresh session creates a new plan while a re-fired
// ExitPlanMode in the same session PATCHes a new version of the same plan.
//
// Verified against the format plannotator (plannotator.ai) uses for ExitPlanMode.
// If a future Claude Code version changes the handshake, `allowDecision` /
// `denyDecision` below are the only things to adjust.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { titleFromMarkdown, buildDigest, decide, allowPayload, denyPayload } from "./consensum-hook-core.mjs";

const BASE = (process.env.CONSENSUM_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.CONSENSUM_API_TOKEN || "";
const SKIP = process.env.CONSENSUM_SKIP === "1" || process.env.CONSENSUM_DISABLED === "1";
const WAIT_MS = 30000; // per long-poll request
const STALE_POLL_MS = 8000; // backoff while waiting for a re-review of our revision
const MAX_MS = Number(process.env.CONSENSUM_LOOP_MAX_MS) || 4 * 24 * 60 * 60 * 1000; // safety deadline

// ---- hook I/O ----------------------------------------------------------------

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}
const allowDecision = () => emit(allowPayload());
const denyDecision = (message) => emit(denyPayload(message));

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

// ---- per-project, per-session state -----------------------------------------

function stateFile(cwd) {
  return join(cwd || process.cwd(), ".consensum", "loop-state.json");
}
function loadState(cwd) {
  try {
    return JSON.parse(readFileSync(stateFile(cwd), "utf8"));
  } catch {
    return {};
  }
}
function saveState(cwd, all) {
  const dir = join(cwd || process.cwd(), ".consensum");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile(cwd), JSON.stringify(all, null, 2));
}

// ---- Consensum machine API ---------------------------------------------------

const authHeaders = { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function api(method, path, body, extraHeaders) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...authHeaders, ...(extraHeaders || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

// ---- main --------------------------------------------------------------------

async function main() {
  const input = readStdin();
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || "default";
  const plan = input.tool_input?.plan;

  if (!plan) allowDecision(); // nothing to review
  if (!TOKEN) {
    if (SKIP) allowDecision(); // deliberate opt-out
    // Fail CLOSED: the hook is installed but misconfigured. Don't ship un-reviewed.
    denyDecision(
      "Consensum review is enabled (the ExitPlanMode hook is installed) but CONSENSUM_API_TOKEN is not set, " +
        "so the plan cannot be submitted for review. Set CONSENSUM_API_TOKEN (and CONSENSUM_BASE_URL) and re-present " +
        "the plan, or set CONSENSUM_SKIP=1 to deliberately bypass review for this session."
    );
  }

  const all = loadState(cwd);
  let entry = all[sessionId];

  // 1) Push a fresh plan, or PATCH a revision of the same session's plan.
  let reviewUrl;
  if (entry?.planId) {
    const patch = await api("PATCH", `/api/plans/${entry.planId}`, { markdown: plan, baseVersionNumber: entry.baseVersionNumber });
    if (patch.status === 409) {
      // Stale base version — re-sync to the server's current version and retry once.
      const snap = await api("GET", `/api/plans/${entry.planId}/feedback`);
      const current = snap.json?.currentVersion;
      if (typeof current === "number") {
        const retry = await api("PATCH", `/api/plans/${entry.planId}`, { markdown: plan, baseVersionNumber: current });
        if (retry.json?.version?.versionNumber) entry.baseVersionNumber = retry.json.version.versionNumber;
        else if (retry.json?.unchanged) entry.baseVersionNumber = current;
        // else: retry itself failed (e.g. another concurrent bump) — leave
        // baseVersionNumber untouched and re-sync on the next iteration rather
        // than persisting a value we know to be stale.
      }
    } else if (patch.status === 404) {
      entry = undefined; // plan vanished (deleted / not owned) — fall through to a fresh push
    } else if (patch.json?.version?.versionNumber) {
      entry.baseVersionNumber = patch.json.version.versionNumber;
    }
    if (entry) reviewUrl = `${BASE}/app/documents/${entry.planId}`;
  }

  if (!entry?.planId) {
    // Idempotency-Key makes a retried create return the same plan instead of a duplicate.
    const idemKey = `${sessionId}:${titleFromMarkdown(plan)}`;
    const created = await api("POST", "/api/plans", { title: titleFromMarkdown(plan), markdown: plan }, { "Idempotency-Key": idemKey });
    if (created.status >= 400 || !created.json?.id) {
      // Fail CLOSED: the push failed, so the plan was not reviewed.
      denyDecision(
        `Consensum push failed (HTTP ${created.status}). The plan was NOT submitted for review, so I won't proceed. ` +
          `Check CONSENSUM_BASE_URL/CONSENSUM_API_TOKEN, then re-present the plan to retry.`
      );
    }
    entry = { planId: created.json.id, baseVersionNumber: 1, lastFingerprint: undefined };
    reviewUrl = created.json.reviewUrl || `${BASE}/app/documents/${entry.planId}`;
    process.stderr.write(`[consensum] Plan posted for review: ${reviewUrl}\n`);
  }
  all[sessionId] = entry;
  saveState(cwd, all);

  // 2) Block until the team renders a verdict on THIS revision.
  const deadline = Date.now() + MAX_MS;
  while (Date.now() < deadline) {
    let fb;
    // While pending, long-poll (blocks server-side). While non-pending-but-stale
    // (a revision we already relayed, awaiting re-review), the wait endpoint
    // returns instantly, so back off with a fixed sleep before re-reading.
    const pendingProbe = await api("GET", `/api/plans/${entry.planId}/feedback`);
    if (pendingProbe.status === 404) {
      // Fail CLOSED: the plan vanished mid-review (deleted / access revoked).
      denyDecision(
        `Consensum plan ${entry.planId} is no longer available (HTTP 404) — it may have been deleted or access revoked. ` +
          `I won't proceed without review; re-present the plan to start a fresh review.`
      );
    }
    if (pendingProbe.json?.decision === "pending") {
      const waited = await api("GET", `/api/plans/${entry.planId}/feedback/wait?timeoutMs=${WAIT_MS}`);
      fb = waited.json || pendingProbe.json;
    } else {
      fb = pendingProbe.json;
    }

    const verdict = decide(fb, entry.lastFingerprint);
    if (verdict.action === "allow") {
      delete all[sessionId];
      saveState(cwd, all);
      allowDecision();
    }
    if (verdict.action === "deny") {
      // New reviewer activity on the current version — relay it and let the agent revise.
      entry.lastFingerprint = verdict.fingerprint;
      all[sessionId] = entry;
      saveState(cwd, all);
      denyDecision(buildDigest(fb, reviewUrl));
    }
    if (verdict.action === "wait") {
      // Stale: same verdict we already relayed; reviewer hasn't re-reviewed our
      // revision yet. Wait quietly.
      await new Promise((r) => setTimeout(r, STALE_POLL_MS));
      continue;
    }
    // pending and timed out: loop re-arms the long-poll.
  }

  denyDecision(`Plan still pending team review after the configured wait window. Re-enter plan mode and present it again when you're ready to retry. Review: ${reviewUrl}`);
}

// Only run the blocking hook when executed directly (not when imported by a test).
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((err) => {
    // FAIL CLOSED: on any unexpected failure, refuse to proceed with an
    // un-reviewed plan and surface the reason in-band to the agent.
    process.stderr.write(`[consensum] hook error: ${err?.stack || err}\n`);
    denyDecision(
      `Consensum review hook hit an unexpected error (${err?.message || err}). ` +
        `I won't proceed without review; re-present the plan to retry, or set CONSENSUM_SKIP=1 to bypass.`
    );
  });
}

export { main };
