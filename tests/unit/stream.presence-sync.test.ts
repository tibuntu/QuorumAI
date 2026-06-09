import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/authz", () => ({ isParticipant: vi.fn() }));

import { GET } from "@/app/api/documents/[id]/stream/route";
import * as api from "@/lib/api";
import * as authz from "@/lib/authz";
import { heartbeat } from "@/lib/presence";

const ctx = { params: Promise.resolve({ id: "stream-doc-1" }) };

describe("GET /api/documents/[id]/stream presence.sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a presence.sync snapshot of the current roster on connect", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "viewer" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    heartbeat("stream-doc-1", { userId: "u1", name: "Ada" });

    const res = await GET(new Request("http://test"), ctx);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = dec.decode((await reader.read()).value);
    buf += dec.decode((await reader.read()).value ?? new Uint8Array());
    expect(buf).toContain("presence.sync");
    expect(buf).toContain('"userId":"u1"');
    await reader.cancel();
  });
});
