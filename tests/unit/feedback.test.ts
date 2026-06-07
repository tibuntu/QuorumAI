import { describe, it, expect } from "vitest";
import { consolidateFeedback, filterThreads } from "@/lib/feedback";

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
