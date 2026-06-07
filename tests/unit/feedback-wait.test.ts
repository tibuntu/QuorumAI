import { describe, it, expect, vi } from "vitest";
import { clampTimeout, waitForFeedbackChange } from "@/lib/feedback-wait";
import type { DocEvent } from "@/lib/events";

type Snap = Awaited<ReturnType<typeof import("@/lib/feedback").getPlanFeedback>>;

const pending = { decision: "pending", state: "OPEN", markdown: "x", threads: [], reviews: [] } as unknown as NonNullable<Snap>;
const approved = { decision: "approved", state: "APPROVED", markdown: "x", threads: [], reviews: [] } as unknown as NonNullable<Snap>;

describe("clampTimeout", () => {
  it("falls back to min(default, max) for missing/NaN/<=0", () => {
    expect(clampTimeout(undefined, 60000, 30000)).toBe(30000);
    expect(clampTimeout(NaN, 60000, 30000)).toBe(30000);
    expect(clampTimeout(0, 60000, 30000)).toBe(30000);
    expect(clampTimeout(-5, 60000, 30000)).toBe(30000);
    expect(clampTimeout(undefined, 10000, 30000)).toBe(10000);
  });
  it("clamps a requested value to the max", () => {
    expect(clampTimeout(45000, 60000, 30000)).toBe(45000);
    expect(clampTimeout(120000, 60000, 30000)).toBe(60000);
  });
});

describe("waitForFeedbackChange", () => {
  it("subscribes before the DB re-check and returns immediately when already terminal", async () => {
    const order: string[] = [];
    const unsubscribe = vi.fn(() => { order.push("unsub"); });
    const subscribe = vi.fn(() => { order.push("sub"); return unsubscribe; });
    const readSnapshot = vi.fn(async () => { order.push("read"); return approved; });

    const res = await waitForFeedbackChange("doc-1", 30000, { subscribe, readSnapshot });

    expect(res).toEqual({ ...approved, timedOut: false });
    expect(order).toEqual(["sub", "read", "unsub"]); // subscribe BEFORE read
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("resolves on a wake event with the fresh snapshot", async () => {
    let handler: ((e: DocEvent) => void) | undefined;
    const subscribe = vi.fn((_id: string, h: (e: DocEvent) => void) => { handler = h; return () => {}; });
    const readSnapshot = vi.fn()
      .mockResolvedValueOnce(pending)   // on-connect re-check
      .mockResolvedValueOnce(approved); // post-wake re-read

    const p = waitForFeedbackChange("doc-1", 30000, { subscribe, readSnapshot });
    await Promise.resolve(); // let the on-connect re-check run
    handler!({ type: "review.updated", state: "APPROVED" });

    expect(await p).toEqual({ ...approved, timedOut: false });
  });

  it("ignores non-wake events", async () => {
    vi.useFakeTimers();
    let handler: ((e: DocEvent) => void) | undefined;
    const subscribe = vi.fn((_id: string, h: (e: DocEvent) => void) => { handler = h; return () => {}; });
    const readSnapshot = vi.fn().mockResolvedValue(pending);

    const p = waitForFeedbackChange("doc-1", 5000, { subscribe, readSnapshot });
    await Promise.resolve();
    handler!({ type: "annotation.created", annotation: {} });
    handler!({ type: "comment.created", annotationId: "a", comment: {} });
    await vi.advanceTimersByTimeAsync(5000); // only the timeout should resolve it
    const res = await p;

    expect(res).toEqual({ ...pending, timedOut: true });
    vi.useRealTimers();
  });

  it("times out with the current pending snapshot", async () => {
    vi.useFakeTimers();
    const subscribe = vi.fn(() => () => {});
    const readSnapshot = vi.fn().mockResolvedValue(pending);

    const p = waitForFeedbackChange("doc-1", 5000, { subscribe, readSnapshot });
    await vi.advanceTimersByTimeAsync(5000);
    const res = await p;

    expect(res).toEqual({ ...pending, timedOut: true });
    vi.useRealTimers();
  });

  it("always unsubscribes, even on the terminal-on-connect path", async () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const readSnapshot = vi.fn().mockResolvedValue(approved);

    await waitForFeedbackChange("doc-1", 30000, { subscribe, readSnapshot });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("returns null when the snapshot is missing", async () => {
    const subscribe = vi.fn(() => () => {});
    const readSnapshot = vi.fn().mockResolvedValue(null);
    expect(await waitForFeedbackChange("gone", 30000, { subscribe, readSnapshot })).toBeNull();
  });
});
