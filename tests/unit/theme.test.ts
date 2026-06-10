import { it, expect, vi } from "vitest";
import {
  resolveDark,
  THEME_SCRIPT,
  STORAGE_KEY,
  THEME_OPTIONS,
  getChoice,
  subscribeTheme,
  emitThemeChange,
} from "../../lib/theme";

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

it("THEME_OPTIONS lists all three choices", () => {
  expect(THEME_OPTIONS).toEqual(["light", "dark", "system"]);
});

it("subscribeTheme notifies subscribers on emit and stops after unsubscribe", () => {
  const cb = vi.fn();
  const unsubscribe = subscribeTheme(cb);
  emitThemeChange();
  expect(cb).toHaveBeenCalledTimes(1);
  unsubscribe();
  emitThemeChange();
  expect(cb).toHaveBeenCalledTimes(1);
});

it("getChoice reads stored choice and falls back to system", () => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });

  expect(getChoice()).toBe("system");
  store[STORAGE_KEY] = "dark";
  expect(getChoice()).toBe("dark");
  store[STORAGE_KEY] = "bogus";
  expect(getChoice()).toBe("system");

  vi.unstubAllGlobals();
});
