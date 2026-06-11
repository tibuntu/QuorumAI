import { describe, expect, test } from "vitest";
import { MAX_REQUIRED_APPROVALS, parseRequiredApprovals, approvalCount } from "@/lib/quorum";

describe("parseRequiredApprovals", () => {
  test("accepts integers 1..10", () => {
    expect(parseRequiredApprovals(1)).toBe(1);
    expect(parseRequiredApprovals(10)).toBe(10);
    expect(parseRequiredApprovals(3)).toBe(3);
    expect(MAX_REQUIRED_APPROVALS).toBe(10);
  });
  test("rejects out-of-range, non-integer, non-number", () => {
    for (const bad of [0, -1, 11, 2.5, NaN, "3", null, undefined, {}, [3]]) {
      expect(parseRequiredApprovals(bad as unknown)).toBeNull();
    }
  });
});

describe("approvalCount", () => {
  test("counts only active APPROVE reviews", () => {
    const reviews = [
      { verdict: "APPROVE", dismissed: false },
      { verdict: "APPROVE", dismissed: true },   // dismissed → excluded
      { verdict: "REQUEST_CHANGES", dismissed: false },
      { verdict: "COMMENT", dismissed: false },
      { verdict: "APPROVE", dismissed: false },
    ];
    expect(approvalCount(reviews)).toBe(2);
    expect(approvalCount([])).toBe(0);
  });
});
