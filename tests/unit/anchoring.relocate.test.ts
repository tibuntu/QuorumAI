import { describe, it, expect } from "vitest";
import { buildQuote, relocate } from "@/lib/anchoring";

const original = "The quick brown fox jumps over the lazy dog.";
function quoteFor(text: string, phrase: string) {
  const start = text.indexOf(phrase);
  return buildQuote(text, start, start + phrase.length);
}

describe("relocate", () => {
  it("returns ACTIVE when the exact text still exists (shifted)", () => {
    const q = quoteFor(original, "quick brown fox");
    const shifted = "Intro sentence. " + original;
    const r = relocate(shifted, q);
    expect(r.status).toBe("ACTIVE");
    expect(shifted.slice(r.range!.start, r.range!.end)).toBe("quick brown fox");
  });

  it("returns MOVED when the anchored text was lightly edited", () => {
    const q = quoteFor(original, "quick brown fox");
    const edited = "The quick brown wolf jumps over the lazy dog.";
    const r = relocate(edited, q);
    expect(r.status).toBe("MOVED");
    expect(r.range).not.toBeNull();
    expect(r.range!.start).toBe(edited.indexOf("quick brown wolf"));
  });

  it("returns ORPHANED when the text is gone", () => {
    const q = quoteFor(original, "quick brown fox");
    const r = relocate("Completely unrelated content with no overlap whatsoever.", q);
    expect(r.status).toBe("ORPHANED");
    expect(r.range).toBeNull();
  });

  it("respects the threshold (below-threshold near-miss is ORPHANED)", () => {
    const q = quoteFor(original, "quick brown fox");
    const r = relocate("xxxxk bxxwn fox", q, { threshold: 0.95 });
    expect(r.status).toBe("ORPHANED");
  });
});
