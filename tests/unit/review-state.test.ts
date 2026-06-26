import { describe, it, expect } from "vitest";
import { computeDocumentState } from "@/lib/review-state";

describe("computeDocumentState", () => {
  it("is OPEN with no reviews", () => {
    expect(computeDocumentState([], 1)).toBe("OPEN");
  });
  it("is CHANGES_REQUESTED when any active review requests changes", () => {
    expect(computeDocumentState([{ verdict: "APPROVE", dismissed: false }, { verdict: "REQUEST_CHANGES", dismissed: false }], 1)).toBe("CHANGES_REQUESTED");
  });
  it("is APPROVED when approvals meet the threshold and no change requests", () => {
    expect(computeDocumentState([{ verdict: "APPROVE", dismissed: false }, { verdict: "APPROVE", dismissed: false }], 2)).toBe("APPROVED");
  });
  it("ignores dismissed reviews", () => {
    expect(computeDocumentState([{ verdict: "REQUEST_CHANGES", dismissed: true }, { verdict: "APPROVE", dismissed: false }], 1)).toBe("APPROVED");
  });
  it("is OPEN when approvals are below the threshold", () => {
    expect(computeDocumentState([{ verdict: "APPROVE", dismissed: false }], 2)).toBe("OPEN");
  });
  it("single veto beats N approvals (2-of-3 with one change request)", () => {
    expect(computeDocumentState([
      { verdict: "APPROVE", dismissed: false },
      { verdict: "APPROVE", dismissed: false },
      { verdict: "REQUEST_CHANGES", dismissed: false },
    ], 2)).toBe("CHANGES_REQUESTED");
  });
  it("is OPEN once all reviews are dismissed", () => {
    expect(computeDocumentState([
      { verdict: "APPROVE", dismissed: true },
      { verdict: "REQUEST_CHANGES", dismissed: true },
    ], 1)).toBe("OPEN");
  });
});
