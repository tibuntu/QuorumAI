import { describe, expect, test, vi } from "vitest";
import { GET } from "@/app/api/notifications/stream/route";
import * as api from "@/lib/api";
import { publish } from "@/lib/events";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

describe("GET /api/notifications/stream", () => {
  test("401 when unauthenticated", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("streams connected + forwarded events for the user", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1" } as never);
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const first = dec.decode((await reader.read()).value);
    expect(first).toContain(": connected");
    publish("user-u1", { type: "notification.read.all" });
    const next = dec.decode((await reader.read()).value);
    expect(next).toContain("notification.read.all");
    await reader.cancel();
  });
});
