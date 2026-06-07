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
