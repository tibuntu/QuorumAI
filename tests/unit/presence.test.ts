import { describe, it, expect } from "vitest";
import { subscribe, type DocEvent } from "@/lib/events";
import { heartbeat, leave, roster, evictStale } from "@/lib/presence";

function capture(docId: string): { events: DocEvent[]; stop: () => void } {
  const events: DocEvent[] = [];
  const stop = subscribe(docId, (e) => events.push(e));
  return { events, stop };
}

describe("presence registry", () => {
  it("heartbeat adds an entry and publishes presence.updated", () => {
    const { events, stop } = capture("p-doc-1");
    heartbeat("p-doc-1", { userId: "u1", name: "Ada" });
    expect(roster("p-doc-1").map((e) => e.userId)).toEqual(["u1"]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "presence.updated" })
    );
    stop();
  });

  it("dedupes repeated heartbeats by userId and bumps lastSeen", () => {
    heartbeat("p-doc-2", { userId: "u1", name: "Ada" });
    const first = roster("p-doc-2")[0].lastSeen;
    heartbeat("p-doc-2", { userId: "u1", name: "Ada Lovelace" });
    const after = roster("p-doc-2");
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("Ada Lovelace");
    expect(after[0].lastSeen).toBeGreaterThanOrEqual(first);
  });

  it("leave removes the entry and publishes presence.left; absent leave is a no-op", () => {
    heartbeat("p-doc-3", { userId: "u1", name: "Ada" });
    const { events, stop } = capture("p-doc-3");
    leave("p-doc-3", "u1");
    expect(roster("p-doc-3")).toHaveLength(0);
    expect(events).toContainEqual({ type: "presence.left", userId: "u1" });
    leave("p-doc-3", "u-absent"); // no throw, no event
    expect(events.filter((e) => e.type === "presence.left")).toHaveLength(1);
    stop();
  });

  it("evictStale removes entries older than PRESENCE_TTL_MS", async () => {
    process.env.PRESENCE_TTL_MS = "5";
    heartbeat("p-doc-4", { userId: "u1", name: "Ada" });
    const { events, stop } = capture("p-doc-4");
    await new Promise((r) => setTimeout(r, 15));
    evictStale();
    expect(roster("p-doc-4")).toHaveLength(0);
    expect(events).toContainEqual({ type: "presence.left", userId: "u1" });
    stop();
    delete process.env.PRESENCE_TTL_MS;
  });

  it("evictStale keeps fresh entries", () => {
    process.env.PRESENCE_TTL_MS = "10000";
    heartbeat("p-doc-5", { userId: "u1", name: "Ada" });
    evictStale();
    expect(roster("p-doc-5")).toHaveLength(1);
    delete process.env.PRESENCE_TTL_MS;
  });

  it("heartbeat stores the selection on the entry and publishes it", () => {
    const { events, stop } = capture("p-doc-6");
    heartbeat("p-doc-6", { userId: "u1", name: "Ada" }, { start: 4, end: 9, versionNumber: 1 });
    expect(roster("p-doc-6")[0].selection).toEqual({ start: 4, end: 9, versionNumber: 1 });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "presence.updated",
        entry: expect.objectContaining({ selection: { start: 4, end: 9, versionNumber: 1 } }),
      })
    );
    stop();
  });

  it("heartbeat without a selection clears a previously stored one", () => {
    heartbeat("p-doc-7", { userId: "u1", name: "Ada" }, { start: 0, end: 3, versionNumber: 2 });
    heartbeat("p-doc-7", { userId: "u1", name: "Ada" }, null);
    expect(roster("p-doc-7")[0].selection).toBeUndefined();
  });

  it("heartbeat stores the cursor on the entry and publishes it", () => {
    const { events, stop } = capture("p-doc-8");
    heartbeat("p-doc-8", { userId: "u1", name: "Ada" }, null, { x: 0.25, y: 0.5 });
    expect(roster("p-doc-8")[0].cursor).toEqual({ x: 0.25, y: 0.5 });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "presence.updated",
        entry: expect.objectContaining({ cursor: { x: 0.25, y: 0.5 } }),
      })
    );
    stop();
  });

  it("heartbeat without a cursor clears a previously stored one", () => {
    heartbeat("p-doc-9", { userId: "u1", name: "Ada" }, null, { x: 0.1, y: 0.2 });
    heartbeat("p-doc-9", { userId: "u1", name: "Ada" }, null, null);
    expect(roster("p-doc-9")[0].cursor).toBeUndefined();
  });

  it("a cursor and a selection coexist on one entry", () => {
    heartbeat(
      "p-doc-10",
      { userId: "u1", name: "Ada" },
      { start: 1, end: 5, versionNumber: 1 },
      { x: 0.3, y: 0.7 },
    );
    const entry = roster("p-doc-10")[0];
    expect(entry.selection).toEqual({ start: 1, end: 5, versionNumber: 1 });
    expect(entry.cursor).toEqual({ x: 0.3, y: 0.7 });
  });
});

describe("presence scroll (P5)", () => {
  it("heartbeat stores a scroll and a later heartbeat without one clears it", () => {
    heartbeat("p-scroll-1", { userId: "u1", name: "Ada" }, null, null, { y: 0.4 });
    expect(roster("p-scroll-1")[0].scroll).toEqual({ y: 0.4 });
    heartbeat("p-scroll-1", { userId: "u1", name: "Ada" });
    expect(roster("p-scroll-1")[0].scroll).toBeUndefined();
  });

  it("scroll coexists with selection and cursor on one entry", () => {
    heartbeat(
      "p-scroll-2",
      { userId: "u1", name: "Ada" },
      { start: 1, end: 4, versionNumber: 2 },
      { x: 0.1, y: 0.2 },
      { y: 0.75 },
    );
    const entry = roster("p-scroll-2")[0];
    expect(entry.selection).toEqual({ start: 1, end: 4, versionNumber: 2 });
    expect(entry.cursor).toEqual({ x: 0.1, y: 0.2 });
    expect(entry.scroll).toEqual({ y: 0.75 });
  });
});
