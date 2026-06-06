import { describe, it, expect } from "vitest";
import { diffMarkdown } from "../../lib/diff";

describe("diffMarkdown", () => {
  it("identical inputs are all unchanged", () => {
    const rows = diffMarkdown("a\nb\nc", "a\nb\nc");
    expect(rows.every((r) => r.kind === "unchanged")).toBe(true);
    expect(rows.map((r) => [r.oldNumber, r.newNumber])).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it("pure addition", () => {
    const rows = diffMarkdown("a\nb", "a\nb\nc");
    const added = rows.filter((r) => r.kind === "added");
    expect(added).toHaveLength(1);
    expect(added[0].newText).toBe("c");
    expect(added[0].oldNumber).toBeUndefined();
  });

  it("pure removal", () => {
    const rows = diffMarkdown("a\nb\nc", "a\nc");
    const removed = rows.filter((r) => r.kind === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].oldText).toBe("b");
    expect(removed[0].newNumber).toBeUndefined();
  });

  it("modified line yields changed row with word spans", () => {
    const rows = diffMarkdown("the quick fox", "the slow fox");
    const changed = rows.find((r) => r.kind === "changed");
    expect(changed).toBeTruthy();
    expect(changed!.oldText).toBe("the quick fox");
    expect(changed!.newText).toBe("the slow fox");
    expect(changed!.newSpans?.some((s) => s.added && s.value.includes("slow"))).toBe(true);
    expect(changed!.oldSpans?.some((s) => s.removed && s.value.includes("quick"))).toBe(true);
  });
});
