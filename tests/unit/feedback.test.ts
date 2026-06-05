import { describe, it, expect } from "vitest";
import { consolidateFeedback } from "@/lib/feedback";

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
