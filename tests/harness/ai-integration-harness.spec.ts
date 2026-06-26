import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AGENT-CONTRACT CONFORMANCE HARNESS
 *
 * Drives a REAL over-the-wire push→annotate→request-changes→wait→revise→409→
 * approve round-trip against a booted Consensum instance, capturing the actual
 * request/response payloads the agent contract produces, so the end-to-end
 * machine contract is exercised (not just unit-mocked) and the captured
 * transcripts can be inspected.
 *
 * Identity model (faithful to production):
 *  - OWNER   = a human who registers and mints an API token (has a session).
 *  - AGENT   = Claude Code acting via the token from a NO-COOKIE request context
 *              (the bare `request` fixture) — this is the true machine contract.
 *  - REVIEWER= a separate human who joins via link-grant and reviews (session cookie).
 */

const EVID = join(process.cwd(), ".planning/ai-integration/evidence");
mkdirSync(EVID, { recursive: true });

const transcript: string[] = [];
function cap(name: string, data: unknown) {
  writeFileSync(join(EVID, `${name}.json`), JSON.stringify(data, null, 2));
  transcript.push(name);
}

async function register(page: Page): Promise<string> {
  const email = `agent-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
  return email;
}

async function mintToken(page: Page, opts: { dropWrite?: boolean } = {}): Promise<string> {
  await page.goto("/app/settings/tokens");
  await page.getByLabel("token label").fill(opts.dropWrite ? "readonly" : "agent");
  if (opts.dropWrite) await page.getByLabel("plans:write").uncheck();
  await page.getByRole("button", { name: "Create token" }).click();
  return page.getByTestId("new-token").inputValue();
}

// Record an agent-side HTTP call (request + parsed response) as evidence.
async function agentCall(
  api: APIRequestContext,
  name: string,
  method: "get" | "post" | "patch",
  path: string,
  token: string,
  body?: unknown,
) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const opts: { headers: Record<string, string>; data?: unknown } = { headers };
  if (body !== undefined) opts.data = body;
  const res = await api[method](path, opts);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = await res.text();
  }
  const record = {
    request: { method: method.toUpperCase(), path, headers: { Authorization: "Bearer csm_<redacted>" }, body: body ?? null },
    response: { status: res.status(), body: json },
  };
  cap(name, record);
  return { status: res.status(), json };
}

const V1 = [
  "# Deploy Plan",
  "",
  "We will provision the cluster on AWS using Terraform.",
  "",
  "The rollback strategy is undefined and risky.",
  "",
  "Please reconsider naming the variables consistently.",
  "",
  "Use kebab-case for resource names.",
  "",
].join("\n");

const V2 = [
  "# Deploy Plan (revised)",
  "",
  "## Infrastructure",
  "",
  "We will provision compute on GCP via Terraform modules.",
  "",
  "The rollback strategy is undefined and risky, so we add an automated rollback step.",
  "",
  "Use kebab-case for resource names.",
  "",
].join("\n");

function offsets(exact: string) {
  const start = V1.indexOf(exact);
  if (start < 0) throw new Error(`anchor not found in V1: ${exact}`);
  return { startOffset: start, endOffset: start + exact.length };
}

async function annotate(
  page: Page,
  id: string,
  exact: string,
  fields: { severity?: string; category?: string; kind?: string; suggestedText?: string },
  bodyText: string,
) {
  const { startOffset, endOffset } = offsets(exact);
  const res = await page.request.post(`/api/documents/${id}/annotations`, {
    data: {
      body: bodyText,
      startOffset,
      endOffset,
      quote: { exact, prefix: "", suffix: "" },
      ...fields,
    },
  });
  return res;
}

test("agent round-trip: push → request-changes → revise → 409 → approve", async ({ browser, request }) => {
  // --- OWNER mints a token ---------------------------------------------------
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner);
  const token = await mintToken(owner);
  expect(token).toMatch(/^csm_/);

  // --- AGENT pushes the plan (true machine contract, no cookies) -------------
  const push = await agentCall(request, "loop-01-push", "post", "/api/plans", token, {
    title: "Deploy Plan",
    markdown: V1,
    agentContext: "Pushed by Claude Code from plan mode; session abc123.",
    requiredApprovals: 1,
  });
  expect(push.status).toBe(201);
  const id = (push.json as { id: string }).id;
  expect(typeof id).toBe("string");

  // --- AGENT re-pushes identical content → IDEMPOTENCY probe -----------------
  const dup = await agentCall(request, "loop-02-duplicate-push", "post", "/api/plans", token, {
    title: "Deploy Plan",
    markdown: V1,
    agentContext: "Pushed by Claude Code from plan mode; session abc123.",
    requiredApprovals: 1,
  });
  const dupId = (dup.json as { id: string }).id;
  cap("loop-02b-idempotency-note", {
    note: "Identical re-POST created a SECOND distinct plan id (no idempotency key).",
    firstId: id,
    secondId: dupId,
    distinct: id !== dupId,
  });

  // --- REVIEWER joins via link-grant and annotates with graded severities ----
  const reviewerCtx = await browser.newContext();
  const reviewer = await reviewerCtx.newPage();
  await register(reviewer);
  const join = await reviewer.request.get(`/api/documents/${id}`);
  expect(join.status()).toBe(200);

  const aMajor = await annotate(reviewer, id, "provision the cluster on AWS", { severity: "MAJOR", category: "architecture" }, "Why AWS? Justify the cloud choice.");
  const aBlocker = await annotate(reviewer, id, "rollback strategy is undefined", { severity: "BLOCKER", category: "safety" }, "Rollback MUST be defined before approval.");
  const aNit = await annotate(reviewer, id, "naming the variables", { severity: "NIT", category: "style" }, "Minor: tighten wording.");
  const aSugg = await annotate(reviewer, id, "kebab-case", { kind: "SUGGESTION", suggestedText: "snake_case", severity: "MINOR" }, "Prefer snake_case for Terraform.");
  for (const r of [aMajor, aBlocker, aNit, aSugg]) expect(r.status()).toBe(201);
  cap("loop-03-annotations-created", {
    note: "Reviewer created 4 graded annotations over a real session.",
    severities: ["MAJOR", "BLOCKER", "NIT", "MINOR(SUGGESTION)"],
  });

  // --- REVIEWER requests changes ---------------------------------------------
  const reqChanges = await reviewer.request.post(`/api/documents/${id}/reviews`, { data: { verdict: "REQUEST_CHANGES" } });
  expect(reqChanges.status()).toBeLessThan(300);
  cap("loop-04-review-request-changes", { status: reqChanges.status(), body: await reqChanges.json() });

  // --- AGENT long-polls and gets the verdict ---------------------------------
  const wait1 = await agentCall(request, "loop-05-wait-changes-requested", "get", `/api/plans/${id}/feedback/wait?timeoutMs=8000`, token);
  expect((wait1.json as { decision: string }).decision).toBe("changes_requested");

  // --- AGENT pulls the actionable (filtered) feedback ------------------------
  await agentCall(request, "loop-06-feedback-filtered", "get", `/api/plans/${id}/feedback?include=blocking,unresolved`, token);
  // ...and the full unfiltered payload.
  await agentCall(request, "loop-07-feedback-full", "get", `/api/plans/${id}/feedback`, token);

  // --- AGENT attempts a STALE revise → 409 -----------------------------------
  const stale = await agentCall(request, "loop-08-patch-stale-409", "patch", `/api/plans/${id}`, token, {
    markdown: V2,
    baseVersionNumber: 99,
  });
  expect(stale.status).toBe(409);

  // --- AGENT revises correctly (v1→v2); MAJOR+NIT anchors orphan -------------
  const revise = await agentCall(request, "loop-09-patch-revise-v2", "patch", `/api/plans/${id}`, token, {
    markdown: V2,
    baseVersionNumber: 1,
  });
  expect(revise.status).toBe(200);
  cap("loop-09b-reanchor-summary", {
    note: "createVersion re-anchors all annotations; MAJOR + NIT anchors were removed in v2.",
    result: revise.json,
  });

  // --- AGENT pulls feedback AFTER revising → KEY EVIDENCE ---------------------
  // Expectation: decision is STILL changes_requested (REQUEST_CHANGES is sticky;
  // only APPROVE reviews are dismissed on a new version), and the annotation
  // threads are STILL threadStatus=OPEN (the agent has no way to mark them
  // addressed; resolution is a human-only action).
  const afterRevise = await agentCall(request, "loop-10-feedback-after-revise", "get", `/api/plans/${id}/feedback`, token);
  const arBody = afterRevise.json as { decision: string; rollup: { unresolved: number }; threads: Array<{ anchorState: string; threadStatus: string }> };
  cap("loop-10b-sticky-analysis", {
    note: "After a revision that addressed the feedback, what does the agent see?",
    decision: arBody.decision,
    unresolvedCount: arBody.rollup?.unresolved,
    anchorStates: arBody.threads?.map((t) => t.anchorState),
    threadStatuses: arBody.threads?.map((t) => t.threadStatus),
    interpretation:
      "decision stays changes_requested and threads stay OPEN even though the agent revised — agent cannot self-resolve; loop depends on a human re-review.",
  });

  // --- REVIEWER re-reviews → APPROVE -----------------------------------------
  const approve = await reviewer.request.post(`/api/documents/${id}/reviews`, { data: { verdict: "APPROVE" } });
  expect(approve.status()).toBeLessThan(300);
  cap("loop-11-review-approve", { status: approve.status(), body: await approve.json() });

  // --- AGENT long-polls and sees approval ------------------------------------
  const wait2 = await agentCall(request, "loop-12-wait-approved", "get", `/api/plans/${id}/feedback/wait?timeoutMs=8000`, token);
  expect((wait2.json as { decision: string }).decision).toBe("approved");

  await ownerCtx.close();
  await reviewerCtx.close();
});

test("edge probes: scope / cross-user / anon / timedOut / oversize", async ({ browser, request }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner);
  const token = await mintToken(owner);
  const readonly = await mintToken(owner, { dropWrite: true });

  // A pending plan for timedOut + cross-user probes.
  const push = await agentCall(request, "probe-00-push", "post", "/api/plans", token, { title: "Probe", markdown: "Pending plan for probes." });
  const id = (push.json as { id: string }).id;

  // 1) token without plans:write → 403
  const noScope = await agentCall(request, "probe-01-missing-scope-403", "post", "/api/plans", readonly, { title: "Nope", markdown: "rejected" });
  expect(noScope.status).toBe(403);

  // 2) cross-user token → 404 (existence mask)
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await register(other);
  const otherToken = await mintToken(other);
  const cross = await agentCall(request, "probe-02-cross-user-404", "get", `/api/plans/${id}/feedback`, otherToken);
  expect(cross.status).toBe(404);

  // 3) anonymous (no token) → 401
  const anon = await request.get(`/api/plans/${id}/feedback`);
  cap("probe-03-anon-401", { status: anon.status(), body: await anon.json().catch(() => null) });
  expect(anon.status()).toBe(401);

  // 4) long-poll with no reviewer activity → timedOut:true
  const timed = await agentCall(request, "probe-04-timedout", "get", `/api/plans/${id}/feedback/wait?timeoutMs=2000`, token);
  expect((timed.json as { timedOut: boolean }).timedOut).toBe(true);

  // 5) oversized markdown — is there any size limit / validation?
  const big = "x".repeat(512 * 1024); // 512 KB
  const oversize = await agentCall(request, "probe-05-oversize", "post", "/api/plans", token, { title: "Big", markdown: big });
  cap("probe-05b-oversize-note", {
    note: "512KB markdown push — observe whether any size limit/validation exists.",
    status: oversize.status,
    acceptedId: (oversize.json as { id?: string }).id ?? null,
  });

  // 6) invalid body → 400
  const badBody = await agentCall(request, "probe-06-bad-body-400", "post", "/api/plans", token, { title: 123, markdown: false });
  expect(badBody.status).toBe(400);

  // 7) requiredApprovals out of range → 400
  const badReq = await agentCall(request, "probe-07-bad-requiredApprovals-400", "post", "/api/plans", token, { title: "x", markdown: "y", requiredApprovals: 99 });
  expect(badReq.status).toBe(400);

  writeFileSync(join(EVID, "TRANSCRIPT.md"), `# AI-integration harness — captured evidence\n\nGenerated by tests/harness/ai-integration-harness.spec.ts against a real booted app.\n\nFiles:\n${transcript.map((t) => `- ${t}.json`).join("\n")}\n`);

  await ownerCtx.close();
  await otherCtx.close();
});
