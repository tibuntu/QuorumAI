import { describe, it, expect } from "vitest";
import { consolidateFeedback, filterThreads, getPlanFeedback, type FeedbackDetail } from "@/lib/feedback";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation, setThreadStatus } from "@/lib/annotations";
import { buildQuote } from "@/lib/anchoring";

describe("consolidateFeedback", () => {
  it("is pending with no comments", () => {
    const r = consolidateFeedback({ state: "OPEN", annotations: [], reviews: [] });
    expect(r.decision).toBe("pending");
    expect(r.markdown).toContain("No inline comments");
  });

  it("summarizes threads and derives changes_requested", () => {
    const r = consolidateFeedback({
      state: "CHANGES_REQUESTED",
      annotations: [{ anchorExact: "cloud setup", status: "ACTIVE", threadStatus: "OPEN", comments: [{ body: "which provider?", author: { name: "Reviewer" } }] }],
      reviews: [{ verdict: "REQUEST_CHANGES", dismissed: false, reviewer: { name: "Reviewer" } }],
    });
    expect(r.decision).toBe("changes_requested");
    expect(r.markdown).toContain("cloud setup");
    expect(r.markdown).toContain("which provider?");
    expect(r.threads).toHaveLength(1);
    expect(r.reviews[0].verdict).toBe("REQUEST_CHANGES");
  });

  it("derives approved", () => {
    const r = consolidateFeedback({ state: "APPROVED", annotations: [], reviews: [{ verdict: "APPROVE", dismissed: false, reviewer: { email: "a@x.com" } }] });
    expect(r.decision).toBe("approved");
  });

  it("includes requiredApprovals + approvals (count of active APPROVE)", () => {
    const detail = {
      state: "OPEN",
      requiredApprovals: 2,
      currentVersion: { versionNumber: 1 },
      versions: [],
      annotations: [],
      reviews: [
        { reviewer: { name: "A" }, verdict: "APPROVE", dismissed: false },
        { reviewer: { name: "B" }, verdict: "APPROVE", dismissed: true },
      ],
    } as unknown as Parameters<typeof consolidateFeedback>[0];
    const out = consolidateFeedback(detail);
    expect(out.requiredApprovals).toBe(2);
    expect(out.approvals).toBe(1);
    expect(out.markdown).toContain("Approvals: 1 of 2");
  });
});

describe("consolidateFeedback identities and timestamps", () => {
  it("exposes comment id/createdAt, thread createdAt, and review id/createdAt/onVersion", () => {
    const detail: FeedbackDetail = {
      state: "CHANGES_REQUESTED",
      annotations: [
        {
          id: "ann_1",
          anchorExact: "services",
          status: "ACTIVE",
          threadStatus: "OPEN",
          kind: "COMMENT",
          createdAt: new Date(0),
          comments: [
            { id: "cmt_1", body: "which provider?", author: { name: "Sam" }, createdAt: new Date(0) },
          ],
        },
      ],
      reviews: [
        {
          id: "rev_1",
          verdict: "REQUEST_CHANGES",
          dismissed: false,
          reviewer: { name: "Sam" },
          createdAt: new Date(0),
          onVersion: { versionNumber: 3 },
        },
      ],
    };
    const { threads, reviews } = consolidateFeedback(detail);
    expect(threads[0].createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(threads[0].comments[0]).toMatchObject({
      id: "cmt_1",
      createdAt: "1970-01-01T00:00:00.000Z",
      body: "which provider?",
    });
    expect(reviews[0]).toMatchObject({
      id: "rev_1",
      verdict: "REQUEST_CHANGES",
      onVersion: 3,
      createdAt: "1970-01-01T00:00:00.000Z",
    });
  });

  it("nulls missing timestamps and ids instead of emitting undefined", () => {
    const detail: FeedbackDetail = {
      state: "OPEN",
      annotations: [
        { anchorExact: "x", status: "ACTIVE", threadStatus: "OPEN", comments: [{ body: "hi" }] },
      ],
      reviews: [{ verdict: "APPROVE", dismissed: false }],
    };
    const { threads, reviews } = consolidateFeedback(detail);
    expect(threads[0].createdAt).toBeNull();
    expect(threads[0].comments[0]).toMatchObject({ id: "", createdAt: null });
    expect(reviews[0]).toMatchObject({ id: "", createdAt: null, onVersion: null });
  });
});

const baseThread = (over: Partial<Parameters<typeof consolidateFeedback>[0]["annotations"][number]> = {}) => ({
  id: "ann_1", anchorExact: "cloud setup", kind: "COMMENT", status: "ACTIVE", threadStatus: "OPEN",
  severity: null, category: null, createdOnVersion: { versionNumber: 1 },
  comments: [{ body: "which provider?", author: { name: "Sam" } }], ...over,
});

it("stamps schemaVersion and structured fields", () => {
  const r = consolidateFeedback({
    state: "CHANGES_REQUESTED",
    currentVersion: { versionNumber: 4 },
    versions: [{ versionNumber: 4, createdAt: new Date(0), createdBy: { name: "Alex" } }],
    annotations: [baseThread({ id: "ann_a", severity: "BLOCKER", category: "security", createdOnVersion: { versionNumber: 4 } })],
    reviews: [{ verdict: "REQUEST_CHANGES", dismissed: false, reviewer: { name: "Sam" } }],
  });
  expect(r.schemaVersion).toBe(1);
  expect(r.currentVersion).toBe(4);
  expect(r.versions[0]).toMatchObject({ number: 4, createdBy: "Alex" });
  expect(r.threads[0]).toMatchObject({ id: "ann_a", severity: "BLOCKER", category: "security", anchorState: "ACTIVE", raisedOnVersion: 4 });
});

describe("mustResolve (binding-severity signal, F2)", () => {
  it("marks an open BLOCKER mustResolve and counts it in the rollup", () => {
    const r = consolidateFeedback({
      state: "APPROVED",
      annotations: [
        baseThread({ id: "blk", severity: "BLOCKER", threadStatus: "OPEN" }),
        baseThread({ id: "maj", severity: "MAJOR", threadStatus: "OPEN" }),
      ],
      reviews: [{ verdict: "APPROVE", dismissed: false, reviewer: { name: "Sam" } }],
    });
    const blk = r.threads.find((t) => t.id === "blk")!;
    const maj = r.threads.find((t) => t.id === "maj")!;
    expect(blk.mustResolve).toBe(true);
    expect(maj.mustResolve).toBe(false);
    expect(r.rollup.mustResolve).toBe(1);
    // The canonical loop-12 trap: decision can be "approved" while a binding
    // blocker is still open — the agent's gate is mustResolve===0 AND approved.
    expect(r.decision).toBe("approved");
    expect(r.rollup.mustResolve).toBeGreaterThan(0);
  });

  it("does not mark a resolved BLOCKER mustResolve", () => {
    const r = consolidateFeedback({
      state: "OPEN",
      annotations: [baseThread({ id: "blk", severity: "BLOCKER", threadStatus: "RESOLVED" })],
      reviews: [],
    });
    expect(r.threads[0].mustResolve).toBe(false);
    expect(r.rollup.mustResolve).toBe(0);
  });
});

describe("agentContext echo (F7)", () => {
  it("echoes agentContext back in the payload", () => {
    const r = consolidateFeedback({
      state: "OPEN",
      agentContext: "session abc123; branch feat/x",
      annotations: [],
      reviews: [],
    });
    expect(r.agentContext).toBe("session abc123; branch feat/x");
  });

  it("is null when none was supplied", () => {
    const r = consolidateFeedback({ state: "OPEN", annotations: [], reviews: [] });
    expect(r.agentContext).toBeNull();
  });
});

describe("resolution reason echo (F7)", () => {
  it("surfaces a thread's resolution when RESOLVED", () => {
    const r = consolidateFeedback({
      state: "OPEN",
      annotations: [baseThread({ id: "r1", threadStatus: "RESOLVED", resolution: "WONTFIX" })],
      reviews: [],
    });
    expect(r.threads[0].resolution).toBe("WONTFIX");
  });
  it("is null on an open thread", () => {
    const r = consolidateFeedback({ state: "OPEN", annotations: [baseThread({ id: "o1" })], reviews: [] });
    expect(r.threads[0].resolution).toBeNull();
  });
});

describe("reviewer-conflict signals (F4)", () => {
  it("counts distinct reviewers requesting changes and flags an approve/reject split", () => {
    const r = consolidateFeedback({
      state: "CHANGES_REQUESTED",
      annotations: [],
      reviews: [
        { verdict: "REQUEST_CHANGES", dismissed: false, reviewer: { name: "A" } },
        { verdict: "REQUEST_CHANGES", dismissed: false, reviewer: { name: "B" } },
        { verdict: "APPROVE", dismissed: false, reviewer: { name: "C" } },
      ],
    });
    expect(r.rollup.reviewersRequestingChanges).toBe(2);
    expect(r.rollup.reviewerSplit).toBe(true);
  });
  it("is calm when reviewers agree", () => {
    const r = consolidateFeedback({
      state: "APPROVED",
      annotations: [],
      reviews: [{ verdict: "APPROVE", dismissed: false, reviewer: { name: "A" } }],
    });
    expect(r.rollup.reviewersRequestingChanges).toBe(0);
    expect(r.rollup.reviewerSplit).toBe(false);
  });
});

it("computes rollups; null severity not blocking, null category bucketed", () => {
  const r = consolidateFeedback({
    state: "CHANGES_REQUESTED",
    currentVersion: { versionNumber: 2 },
    versions: [{ versionNumber: 1, createdAt: new Date(0), createdBy: { name: "A" } }, { versionNumber: 2, createdAt: new Date(0), createdBy: { name: "A" } }],
    annotations: [
      baseThread({ id: "a1", severity: "BLOCKER", category: "security", threadStatus: "OPEN", createdOnVersion: { versionNumber: 2 } }),
      baseThread({ id: "a2", severity: null, category: null, threadStatus: "OPEN", createdOnVersion: { versionNumber: 1 } }),
      baseThread({ id: "a3", severity: "NIT", category: "naming", threadStatus: "RESOLVED", createdOnVersion: { versionNumber: 1 } }),
    ],
    reviews: [],
  });
  expect(r.rollup.blocking).toBe(1);
  expect(r.rollup.unresolved).toBe(2);
  expect(r.rollup.total).toBe(3);
  expect(r.rollup.byCategory).toEqual({ security: 1, uncategorized: 1, naming: 1 });
  expect(r.rollup.byVersion).toEqual({ "1": 2, "2": 1 });
});

it("filterThreads honors include/exclude; exclude wins", () => {
  const r = consolidateFeedback({
    state: "CHANGES_REQUESTED", currentVersion: { versionNumber: 1 },
    versions: [{ versionNumber: 1, createdAt: new Date(0), createdBy: { name: "A" } }],
    annotations: [
      baseThread({ id: "b", severity: "BLOCKER", threadStatus: "OPEN" }),
      baseThread({ id: "n", severity: "NIT", threadStatus: "RESOLVED", status: "ACTIVE" }),
      baseThread({ id: "o", severity: "MAJOR", threadStatus: "OPEN", status: "ORPHANED" }),
    ],
    reviews: [],
  });
  expect(filterThreads(r.threads, { include: ["blocking"] }).map((t) => t.id)).toEqual(["b"]);
  expect(filterThreads(r.threads, { include: ["unresolved"], exclude: ["orphaned"] }).map((t) => t.id)).toEqual(["b"]);
  expect(filterThreads(r.threads, {}).map((t) => t.id)).toEqual(["b", "n", "o"]);
});

it("buckets empty/whitespace category as uncategorized", () => {
  const t = (id: string, category: string | null) => ({
    id, anchorExact: "q", kind: "COMMENT", status: "ACTIVE", threadStatus: "OPEN",
    severity: null, category, createdOnVersion: { versionNumber: 1 },
    comments: [{ body: "c", author: { name: "S" } }],
  });
  const r = consolidateFeedback({
    state: "OPEN", currentVersion: { versionNumber: 1 },
    versions: [{ versionNumber: 1, createdAt: new Date(0), createdBy: { name: "A" } }],
    annotations: [t("a", null), t("b", ""), t("c", "   "), t("d", "security")],
    reviews: [],
  });
  expect(r.rollup.byCategory).toEqual({ uncategorized: 3, security: 1 });
});

it("markdown leads with blocker then unresolved", () => {
  const r = consolidateFeedback({
    state: "CHANGES_REQUESTED", currentVersion: { versionNumber: 1 },
    versions: [{ versionNumber: 1, createdAt: new Date(0), createdBy: { name: "A" } }],
    annotations: [
      baseThread({ id: "nit", anchorExact: "typo", severity: "NIT", threadStatus: "RESOLVED" }),
      baseThread({ id: "blk", anchorExact: "secret in code", severity: "BLOCKER", threadStatus: "OPEN" }),
    ],
    reviews: [],
  });
  expect(r.markdown.indexOf("secret in code")).toBeLessThan(r.markdown.indexOf("typo"));
});

it("getPlanFeedback: rollups stay unfiltered while threads are filtered", async () => {
  const now = new Date();
  const user = await prisma.user.create({ data: { id: `u-${Date.now()}-fb`, name: "Alex", email: `u-${Date.now()}-fb@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
  const md = "Store the secret in code? Also a tiny typo here.";
  const docId = await createDocument(user.id, "Plan", md);
  const s1 = md.indexOf("secret in code");
  await createAnnotation(user.id, docId, { quote: buildQuote(md, s1, s1 + 14), startOffset: s1, endOffset: s1 + 14, severity: "BLOCKER", category: "security" }, "no secrets in code");
  const s2 = md.indexOf("typo");
  const nit = await createAnnotation(user.id, docId, { quote: buildQuote(md, s2, s2 + 4), startOffset: s2, endOffset: s2 + 4, severity: "NIT", category: "naming" }, "typo");
  await setThreadStatus(user.id, nit.id, "RESOLVED");
  await prisma.document.update({ where: { id: docId }, data: { state: "CHANGES_REQUESTED" } });

  const all = await getPlanFeedback(docId);
  expect(all?.rollup.blocking).toBe(1);
  expect(all?.rollup.total).toBe(2);

  const filtered = await getPlanFeedback(docId, { include: ["blocking"] });
  expect(filtered?.threads).toHaveLength(1);
  expect(filtered?.threads[0].severity).toBe("BLOCKER");
  expect(filtered?.rollup.total).toBe(2); // unfiltered totals preserved
  await prisma.document.delete({ where: { id: docId } });
});

describe("consolidateFeedback provenance", () => {
  it("marks an applied suggestion as applied-in-vN", () => {
    const detail: FeedbackDetail = {
      state: "OPEN",
      annotations: [
        {
          anchorExact: "cloud setup",
          status: "ORPHANED",
          threadStatus: "RESOLVED",
          kind: "SUGGESTION",
          suggestedText: "k8s cluster",
          appliedInVersion: { versionNumber: 2 },
          comments: [{ body: "rename it", author: { name: "Rev" } }],
        },
      ],
      reviews: [],
    };
    const { markdown } = consolidateFeedback(detail);
    expect(markdown).toContain("[applied as v2]");
  });

  it("does not mark unapplied threads", () => {
    const detail: FeedbackDetail = {
      state: "OPEN",
      annotations: [
        { anchorExact: "cloud setup", status: "ACTIVE", threadStatus: "OPEN", comments: [{ body: "hm" }] },
      ],
      reviews: [],
    };
    expect(consolidateFeedback(detail).markdown).not.toContain("applied as");
  });
});

describe("consolidateFeedback suggestions", () => {
  it("exposes suggestedText on suggestion threads and null on plain comments", () => {
    const detail: FeedbackDetail = {
      state: "CHANGES_REQUESTED",
      annotations: [
        {
          anchorExact: "services",
          status: "ACTIVE",
          threadStatus: "OPEN",
          kind: "SUGGESTION",
          suggestedText: "URLs",
          comments: [{ body: "Suggested edit", author: { name: "Tibuntu" } }],
        },
        {
          anchorExact: "cloud setup",
          status: "ACTIVE",
          threadStatus: "OPEN",
          kind: "COMMENT",
          comments: [{ body: "which provider?", author: { name: "Sam" } }],
        },
      ],
      reviews: [],
    };
    const { threads } = consolidateFeedback(detail);
    expect(threads[0]).toMatchObject({ kind: "SUGGESTION", suggestedText: "URLs" });
    expect(threads[1].suggestedText).toBeNull();
  });

  it("surfaces the suggested replacement in the markdown digest", () => {
    const detail: FeedbackDetail = {
      state: "CHANGES_REQUESTED",
      annotations: [
        {
          anchorExact: "services",
          status: "ACTIVE",
          threadStatus: "OPEN",
          kind: "SUGGESTION",
          suggestedText: "URLs",
          comments: [{ body: "Suggested edit", author: { name: "Tibuntu" } }],
        },
      ],
      reviews: [],
    };
    expect(consolidateFeedback(detail).markdown).toContain('Suggested replacement:_ "URLs"');
  });
});

describe("consolidateFeedback anchor span", () => {
  it("exposes offsets and anchor context, nulling absent values", () => {
    const detail: FeedbackDetail = {
      state: "CHANGES_REQUESTED",
      annotations: [
        {
          anchorExact: "services",
          anchorPrefix: "the ",
          anchorSuffix: " layer",
          startOffset: 10,
          endOffset: 18,
          status: "ACTIVE",
          threadStatus: "OPEN",
          kind: "SUGGESTION",
          suggestedText: "URLs",
          comments: [{ body: "Suggested edit", author: { name: "Tibuntu" } }],
        },
        {
          anchorExact: null,
          status: "ACTIVE",
          threadStatus: "OPEN",
          kind: "COMMENT",
          comments: [{ body: "general note", author: { name: "Sam" } }],
        },
      ],
      reviews: [],
    };
    const { threads } = consolidateFeedback(detail);
    expect(threads[0]).toMatchObject({
      startOffset: 10,
      endOffset: 18,
      anchorPrefix: "the ",
      anchorSuffix: " layer",
    });
    expect(threads[1]).toMatchObject({
      startOffset: null,
      endOffset: null,
      anchorPrefix: null,
      anchorSuffix: null,
    });
  });
});
