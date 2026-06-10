import { describe, it, expect } from "vitest";
import { startsWithH1 } from "@/lib/markdown-heading";

describe("startsWithH1", () => {
  it("detects a leading ATX H1", () => {
    expect(startsWithH1("# Title\n\nbody")).toBe(true);
    expect(startsWithH1("# Title")).toBe(true);
  });

  it("skips leading blank lines", () => {
    expect(startsWithH1("\n\n# Title\nbody")).toBe(true);
    expect(startsWithH1("   \n# Title")).toBe(true);
  });

  it("allows up to 3 leading spaces", () => {
    expect(startsWithH1("   # Title")).toBe(true);
    expect(startsWithH1("    # Title")).toBe(false); // 4 spaces = code block
  });

  it("is false for deeper headings", () => {
    expect(startsWithH1("## Subhead\n# Later")).toBe(false);
    expect(startsWithH1("### Three")).toBe(false);
  });

  it("is false when the doc does not open with a heading", () => {
    expect(startsWithH1("Intro paragraph\n\n# Heading")).toBe(false);
    expect(startsWithH1("- list item")).toBe(false);
    expect(startsWithH1("")).toBe(false);
  });

  it("requires a space after the hash (not '#tag')", () => {
    expect(startsWithH1("#hashtag not a heading")).toBe(false);
  });

  it("does not treat Setext underlines as a leading H1", () => {
    expect(startsWithH1("Title\n=====\n")).toBe(false);
  });
});
