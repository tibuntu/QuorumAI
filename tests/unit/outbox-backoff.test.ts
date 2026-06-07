import { describe, it, expect, afterEach } from "vitest";
import { computeBackoffMs } from "@/lib/outbox";

describe("computeBackoffMs", () => {
  afterEach(() => { delete process.env.OUTBOX_BACKOFF_MS; });

  it("returns the default table for attempts 1..5", () => {
    expect([1, 2, 3, 4, 5].map(computeBackoffMs)).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
  });

  it("clamps to the last entry past the table length", () => {
    expect(computeBackoffMs(6)).toBe(21_600_000);
    expect(computeBackoffMs(99)).toBe(21_600_000);
  });

  it("honors OUTBOX_BACKOFF_MS override", () => {
    process.env.OUTBOX_BACKOFF_MS = "10,20,30";
    expect([1, 2, 3, 4].map(computeBackoffMs)).toEqual([10, 20, 30, 30]);
  });
});
