import { describe, it, expect } from "vitest";
import { resolveDark, THEME_SCRIPT, STORAGE_KEY } from "../../lib/theme";

it("resolveDark explicit choices", () => {
  expect(resolveDark("dark", false)).toBe(true);
  expect(resolveDark("light", true)).toBe(false);
});

it("resolveDark system follows OS", () => {
  expect(resolveDark("system", true)).toBe(true);
  expect(resolveDark("system", false)).toBe(false);
});

it("THEME_SCRIPT references storage + classList", () => {
  expect(THEME_SCRIPT).toContain(STORAGE_KEY);
  expect(THEME_SCRIPT).toContain("classList");
});
