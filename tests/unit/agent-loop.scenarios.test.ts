import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument, deleteDocument } from "@/lib/documents";
import { getPlanFeedback } from "@/lib/feedback";
import { createVersion, ConcurrencyError } from "@/lib/versions";
import { submitReview } from "@/lib/reviews";
import { createAnnotation, setThreadStatus } from "@/lib/annotations";
import { computeDocumentState } from "@/lib/review-state";
import { buildQuote } from "@/lib/anchoring";
import { generateToken } from "@/lib/tokens";
import { POST } from "@/app/api/plans/route";

// Agent-loop scenario corpus — the contract behaviors replayed deterministically
// against the route handlers + consolidateFeedback, with no app boot and no model.
// Several scenarios deliberately ASSERT current behavior (reviewer-conflict
// surfacing, orphaned-anchor quote retention, resolution reasons, idempotent
// create) so a future regression is caught. Runs under `pnpm test:unit`.

let n = 0;
async function makeUser() {
  const now = new Date();
  n++;
  const tag = `${Date.now()}-${n}`;
  return prisma.user.create({
    data: { id: `u-${tag}`, name: "U", email: `u-${tag}@example.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

function planReq(token: string | null, body: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/plans", { method: "POST", headers: h, body: JSON.stringify(body) });
}

describe("agent-loop scenario corpus (S1–S12)", () => {
  it("S1 — clean approve: one APPROVE at threshold 1 ⇒ approved", async () => {
    expect(computeDocumentState([{ verdict: "APPROVE", dismissed: false }], 1)).toBe("APPROVED");
    const owner = await makeUser();
    const reviewer = await makeUser();
    const id = await createDocument(owner.id, "Plan", "# P\n\nship it");
    await submitReview(reviewer.id, id, "APPROVE");
    const fb = await getPlanFeedback(id);
    expect(fb?.decision).toBe("approved");
    expect(fb?.rollup.mustResolve).toBe(0);
    await deleteDocument(id);
  });

  it("S2 — request-changes → revise → approve; REQUEST_CHANGES is sticky across the revision (A3)", async () => {
    const owner = await makeUser();
    const reviewer = await makeUser();
    const id = await createDocument(owner.id, "Plan", "# P\n\nv1 body");
    await submitReview(reviewer.id, id, "REQUEST_CHANGES");
    expect((await getPlanFeedback(id))?.decision).toBe("changes_requested");

    const res = await createVersion(owner.id, id, 1, "# P\n\nv2 body addressing feedback");
    expect(res.unchanged).toBe(false);
    // Sticky: a new version dismisses only APPROVE — the REQUEST_CHANGES survives.
    expect((await getPlanFeedback(id))?.decision).toBe("changes_requested");
    const rcStillActive = await prisma.review.findFirst({ where: { documentId: id, verdict: "REQUEST_CHANGES" } });
    expect(rcStillActive?.dismissed).toBe(false);

    await submitReview(reviewer.id, id, "APPROVE"); // re-review
    expect((await getPlanFeedback(id))?.decision).toBe("approved");
    await deleteDocument(id);
  });

  it("S3 — stale baseVersionNumber ⇒ ConcurrencyError (optimistic lock)", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Plan", "# P\n\nbody");
    await expect(createVersion(owner.id, id, 99, "# P\n\nnope")).rejects.toBeInstanceOf(ConcurrencyError);
    await deleteDocument(id);
  });

  it("S6 — conflicting reviewers: both threads surface; conflict is signalled at the rollup, not auto-resolved per thread", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const md = "alpha beta gamma";
    const id = await createDocument(owner.id, "Plan", md);
    const s1 = md.indexOf("alpha");
    const s2 = md.indexOf("gamma");
    await createAnnotation(a.id, id, { quote: buildQuote(md, s1, s1 + 5), startOffset: s1, endOffset: s1 + 5 }, "do X");
    await createAnnotation(b.id, id, { quote: buildQuote(md, s2, s2 + 5), startOffset: s2, endOffset: s2 + 5 }, "do NOT do X");
    await submitReview(a.id, id, "REQUEST_CHANGES");
    await submitReview(b.id, id, "REQUEST_CHANGES");
    const fb = await getPlanFeedback(id);
    expect(fb?.threads).toHaveLength(2);
    expect(fb?.decision).toBe("changes_requested");
    // Conflict is surfaced at the rollup level so the agent escalates rather than
    // picking a side — two distinct reviewers requested changes.
    expect(fb?.rollup.reviewersRequestingChanges).toBe(2);
    // It is NOT auto-resolved per thread (no semantic conflict detection without an LLM).
    expect(fb?.threads.every((t) => !("conflict" in t))).toBe(true);
    await deleteDocument(id);
  });

  it("S7 — orphaned anchor RETAINS its quote text; only offsets null", async () => {
    const owner = await makeUser();
    const md1 = "alpha beta gamma";
    const id = await createDocument(owner.id, "Plan", md1);
    const start = md1.indexOf("alpha");
    await createAnnotation(owner.id, id, { quote: buildQuote(md1, start, start + 5), startOffset: start, endOffset: start + 5, severity: "BLOCKER" }, "blocker on alpha");
    await createVersion(owner.id, id, 1, "beta gamma delta"); // "alpha" removed → orphaned
    const fb = await getPlanFeedback(id);
    const t = fb!.threads[0];
    expect(t.anchorState).toBe("ORPHANED");
    expect(t.startOffset).toBeNull();
    expect(t.quote).toBe("alpha"); // text preserved — only the position is lost
    await deleteDocument(id);
  });

  it("S8 — resolved thread carries its resolution reason so the agent can skip won't-fix", async () => {
    const owner = await makeUser();
    const md = "alpha beta";
    const id = await createDocument(owner.id, "Plan", md);
    const start = md.indexOf("alpha");
    const ann = await createAnnotation(owner.id, id, { quote: buildQuote(md, start, start + 5), startOffset: start, endOffset: start + 5 }, "c");
    await setThreadStatus(owner.id, ann.id, "RESOLVED", "WONTFIX");
    const fb = await getPlanFeedback(id);
    const t = fb!.threads[0];
    expect(t.threadStatus).toBe("RESOLVED");
    expect(t.resolution).toBe("WONTFIX"); // fixed / won't-fix / obsolete are now distinguishable
    await deleteDocument(id);
  });

  it("S9 — idempotent create: repeated Idempotency-Key returns the SAME plan, no duplicate", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const body = { title: "Deploy", markdown: "# Deploy\n\nplan" };
    const r1 = await POST(planReq(token, body, { "idempotency-key": "key-1" }));
    expect(r1.status).toBe(201);
    const j1 = await r1.json();
    const r2 = await POST(planReq(token, body, { "idempotency-key": "key-1" }));
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    expect(j2.id).toBe(j1.id);
    expect(j2.idempotent).toBe(true);
    // No key ⇒ a fresh plan (back-compat).
    const r3 = await POST(planReq(token, body));
    const j3 = await r3.json();
    expect(j3.id).not.toBe(j1.id);
    await deleteDocument(j1.id);
    await deleteDocument(j3.id);
  });

  it("S10 — token without plans:write ⇒ 403", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "readonly", { scopes: "feedback:read" });
    const res = await POST(planReq(token, { title: "x", markdown: "y" }));
    expect(res.status).toBe(403);
  });

  it("S11 — no Authorization ⇒ 401", async () => {
    const res = await POST(planReq(null, { title: "x", markdown: "y" }));
    expect(res.status).toBe(401);
  });

  it("S12 — oversized markdown ⇒ 413 (size cap)", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const huge = "x".repeat(1_100_000); // > 1 MB default cap
    const res = await POST(planReq(token, { title: "Big", markdown: huge }));
    expect(res.status).toBe(413);
  });
});
