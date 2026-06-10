import { describe, it, expect } from "vitest";
import { SESSION_ACTIONS } from "@/lib/enums";

describe("SESSION_ACTIONS", () => {
  it("is the exact start/join/leave/end set", () => {
    expect([...SESSION_ACTIONS]).toEqual(["start", "join", "leave", "end"]);
  });
});
