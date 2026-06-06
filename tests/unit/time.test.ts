import { describe, it, expect, vi, afterEach } from "vitest";
import { relativeTime } from "@/lib/time";

const NOW = new Date("2026-06-06T12:00:00Z").getTime();
function ago(ms: number) {
  return new Date(NOW - ms);
}

describe("relativeTime", () => {
  afterEach(() => vi.useRealTimers());

  function withNow<T>(fn: () => T): T {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    return fn();
  }

  it("says 'just now' under 45 seconds", () => {
    expect(withNow(() => relativeTime(ago(10_000)))).toBe("just now");
  });

  it("renders minutes", () => {
    expect(withNow(() => relativeTime(ago(5 * 60_000)))).toBe("5m ago");
  });

  it("renders hours", () => {
    expect(withNow(() => relativeTime(ago(3 * 3_600_000)))).toBe("3h ago");
  });

  it("renders days", () => {
    expect(withNow(() => relativeTime(ago(2 * 86_400_000)))).toBe("2d ago");
  });

  it("accepts ISO strings", () => {
    expect(withNow(() => relativeTime(ago(5 * 60_000).toISOString()))).toBe("5m ago");
  });
});
