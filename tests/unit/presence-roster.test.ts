import { describe, it, expect } from "vitest";
import {
  initials,
  colorFor,
  viewingLabel,
  orderRoster,
  displayName,
  AVATAR_COLORS,
  SELECTION_COLORS,
  selectionColorFor,
} from "@/lib/presence-roster";
import type { PresenceEntry } from "@/lib/events";

const entry = (userId: string, name: string): PresenceEntry => ({ userId, name, lastSeen: 0 });

describe("presence-roster helpers", () => {
  it("initials: first+last initial, single-token fallback, blank guard", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Grace")).toBe("GR");
    expect(initials("  ")).toBe("?");
    expect(initials("Ada Byron Lovelace")).toBe("AL");
  });

  it("colorFor: deterministic and within the palette", () => {
    expect(colorFor("user-1")).toBe(colorFor("user-1"));
    expect(AVATAR_COLORS).toContain(colorFor("user-1"));
    expect(AVATAR_COLORS).toContain(colorFor("xyz"));
  });

  it("viewingLabel: singular vs plural", () => {
    expect(viewingLabel(1)).toBe("1 person viewing");
    expect(viewingLabel(3)).toBe("3 people viewing");
  });

  it("orderRoster: self first, others stable by userId", () => {
    const ordered = orderRoster([entry("u2", "Grace"), entry("me", "Ada"), entry("u1", "Alan")], "me");
    expect(ordered.map((e) => e.userId)).toEqual(["me", "u1", "u2"]);
  });

  it("displayName: marks only the current user", () => {
    expect(displayName(entry("me", "Ada"), "me")).toBe("Ada (you)");
    expect(displayName(entry("u2", "Grace"), "me")).toBe("Grace");
  });
});

describe("selectionColorFor", () => {
  it("is deterministic and drawn from SELECTION_COLORS", () => {
    const c = selectionColorFor("user-abc");
    expect(selectionColorFor("user-abc")).toBe(c);
    expect(SELECTION_COLORS).toContain(c);
  });

  it("uses the same palette index as the avatar color", () => {
    for (const id of ["u1", "user-abc", "cmh000xyz"]) {
      expect(SELECTION_COLORS.indexOf(selectionColorFor(id) as (typeof SELECTION_COLORS)[number]))
        .toBe(AVATAR_COLORS.indexOf(colorFor(id) as (typeof AVATAR_COLORS)[number]));
    }
  });
});
