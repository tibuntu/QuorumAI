import { describe, it, expect } from "vitest";
import { applyPresenceEvent } from "@/lib/presence-client";
import type { PresenceEntry } from "@/lib/events";

const self = { userId: "me", name: "Ada" };
const entry = (userId: string, name: string): PresenceEntry => ({ userId, name, lastSeen: 1 });

describe("applyPresenceEvent", () => {
  it("sync replaces the roster and re-adds self when missing", () => {
    const next = applyPresenceEvent([], { type: "presence.sync", roster: [entry("u2", "Grace")] }, self);
    expect(next.map((e) => e.userId).sort()).toEqual(["me", "u2"]);
  });

  it("sync keeps self exactly once when already present", () => {
    const next = applyPresenceEvent([], { type: "presence.sync", roster: [entry("me", "Ada")] }, self);
    expect(next.filter((e) => e.userId === "me")).toHaveLength(1);
  });

  it("updated upserts by userId", () => {
    const start = [entry("me", "Ada")];
    const next = applyPresenceEvent(start, { type: "presence.updated", entry: entry("u2", "Grace") }, self);
    expect(next.map((e) => e.userId).sort()).toEqual(["me", "u2"]);
    const again = applyPresenceEvent(next, { type: "presence.updated", entry: entry("u2", "Grace Hopper") }, self);
    expect(again.filter((e) => e.userId === "u2")).toHaveLength(1);
    expect(again.find((e) => e.userId === "u2")!.name).toBe("Grace Hopper");
  });

  it("left removes by userId", () => {
    const start = [entry("me", "Ada"), entry("u2", "Grace")];
    const next = applyPresenceEvent(start, { type: "presence.left", userId: "u2" }, self);
    expect(next.map((e) => e.userId)).toEqual(["me"]);
  });

  it("ignores unrelated events", () => {
    const start = [entry("me", "Ada")];
    const next = applyPresenceEvent(start, { type: "review.updated", state: "OPEN" }, self);
    expect(next).toBe(start);
  });
});
