import { describe, expect, test } from "vitest";
import { DEFAULT_PREFS, parsePrefs, isEnabled, isValidCell, applyPatch } from "@/lib/notification-prefs";

describe("DEFAULT_PREFS preserves prior behavior", () => {
  test("inApp on, email on for c/r/v, desktop off, resolve has no email", () => {
    for (const t of ["comment", "review", "version", "resolve"] as const) {
      expect(DEFAULT_PREFS[t].inApp).toBe(true);
      expect(DEFAULT_PREFS[t].desktop).toBe(false);
    }
    expect(DEFAULT_PREFS.comment.email).toBe(true);
    expect(DEFAULT_PREFS.review.email).toBe(true);
    expect(DEFAULT_PREFS.version.email).toBe(true);
    expect("email" in DEFAULT_PREFS.resolve).toBe(false);
  });
});

describe("parsePrefs", () => {
  test("null/garbage → defaults (never throws)", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(42)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("x")).toEqual(DEFAULT_PREFS);
  });
  test("merges known boolean cells, ignores unknown keys + non-booleans", () => {
    const p = parsePrefs({
      comment: { email: false, desktop: true, bogusChannel: true },
      bogusType: { inApp: false },
      review: { email: "nope" },
    });
    expect(p.comment.email).toBe(false);
    expect(p.comment.desktop).toBe(true);
    expect(p.comment.inApp).toBe(true);
    expect(p.review.email).toBe(true);
    expect((p as Record<string, unknown>).bogusType).toBeUndefined();
    expect((p.comment as Record<string, unknown>).bogusChannel).toBeUndefined();
  });
  test("resolve email is never set even if present in input", () => {
    const p = parsePrefs({ resolve: { email: true } });
    expect("email" in p.resolve).toBe(false);
  });
});

describe("isEnabled", () => {
  test("reads the cell, false for missing", () => {
    expect(isEnabled(DEFAULT_PREFS, "comment", "inApp")).toBe(true);
    expect(isEnabled(DEFAULT_PREFS, "comment", "desktop")).toBe(false);
    expect(isEnabled(DEFAULT_PREFS, "resolve", "email")).toBe(false);
  });
});

describe("isValidCell", () => {
  test("true for real cells, false for resolve+email and unknowns", () => {
    expect(isValidCell("comment", "email")).toBe(true);
    expect(isValidCell("resolve", "desktop")).toBe(true);
    expect(isValidCell("resolve", "email")).toBe(false);
    expect(isValidCell("bogus", "inApp")).toBe(false);
    expect(isValidCell("comment", "bogus")).toBe(false);
  });
});

describe("applyPatch", () => {
  test("sets one cell immutably", () => {
    const next = applyPatch(DEFAULT_PREFS, "comment", "email", false);
    expect(next.comment.email).toBe(false);
    expect(DEFAULT_PREFS.comment.email).toBe(true);
  });
  test("throws on invalid cell", () => {
    expect(() => applyPatch(DEFAULT_PREFS, "resolve", "email", true)).toThrow();
  });
});
