import { describe, it, expect } from "vitest";
import { publish, subscribe, type DocEvent, type PresenceEntry } from "@/lib/events";

describe("presence events on the bus", () => {
  it("delivers presence.updated to subscribers of the same document", () => {
    const got: DocEvent[] = [];
    const unsub = subscribe("doc-presence-1", (e) => got.push(e));
    const entry: PresenceEntry = { userId: "u1", name: "Ada", lastSeen: 1000 };
    publish("doc-presence-1", { type: "presence.updated", entry });
    publish("doc-presence-2", { type: "presence.left", userId: "u9" });
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual({ type: "presence.updated", entry });
    unsub();
  });

  it("carries a full roster on presence.sync", () => {
    const got: DocEvent[] = [];
    const unsub = subscribe("doc-presence-3", (e) => got.push(e));
    const roster: PresenceEntry[] = [{ userId: "u1", name: "Ada", lastSeen: 1 }];
    publish("doc-presence-3", { type: "presence.sync", roster });
    expect(got[0]).toEqual({ type: "presence.sync", roster });
    unsub();
  });
});
