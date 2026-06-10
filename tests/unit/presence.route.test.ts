import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/authz", () => ({ isParticipant: vi.fn() }));
vi.mock("@/lib/presence", () => ({ heartbeat: vi.fn(), leave: vi.fn() }));

import { POST } from "@/app/api/documents/[id]/presence/route";
import * as api from "@/lib/api";
import * as authz from "@/lib/authz";
import * as presence from "@/lib/presence";

function req(body?: unknown): Request {
  return new Request("http://test/api/documents/doc1/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: "doc1" }) };

describe("POST /api/documents/[id]/presence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(401);
  });

  it("404 when not a participant", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(false);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
  });

  it("heartbeats and returns 204 for a participant", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null, null);
    expect(presence.leave).not.toHaveBeenCalled();
  });

  it("leaves when body says leaving:true", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ leaving: true }), ctx);
    expect(res.status).toBe(204);
    expect(presence.leave).toHaveBeenCalledWith("doc1", "u1");
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });

  it("falls back to email then 'Someone' for a blank name", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "", email: "a@b.co" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    await POST(req(), ctx);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "a@b.co" }, null, null, null);
  });

  it("passes a valid selection through to heartbeat", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ selection: { start: 2, end: 7, versionNumber: 3 } }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith(
      "doc1",
      { userId: "u1", name: "Ada" },
      { start: 2, end: 7, versionNumber: 3 },
      null,
      null,
    );
  });

  it("treats selection:null as clearing", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ selection: null }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null, null);
  });

  it.each([
    { start: 5, end: 5, versionNumber: 1 }, // empty range
    { start: -1, end: 4, versionNumber: 1 }, // negative start
    { start: 0, end: 4, versionNumber: 0 }, // version < 1
    { start: 0.5, end: 4, versionNumber: 1 }, // non-integer
    { start: 0, end: 4 }, // missing versionNumber
    "nonsense", // wrong type
  ])("rejects malformed selection %j with 400", async (selection) => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ selection }), ctx);
    expect(res.status).toBe(400);
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });

  it("returns 204 and heartbeats with null when the body is not parseable JSON", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(
      new Request("http://test/api/documents/doc1/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
      ctx,
    );
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null, null);
  });

  it("rejects selections beyond the sanity cap with 400", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ selection: { start: 0, end: 10_000_001, versionNumber: 1 } }), ctx);
    expect(res.status).toBe(400);
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });

  it("passes a valid cursor through to heartbeat", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ cursor: { x: 0.25, y: 0.75 } }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith(
      "doc1",
      { userId: "u1", name: "Ada" },
      null,
      { x: 0.25, y: 0.75 },
      null,
    );
  });

  it("passes selection and cursor together", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(
      req({ selection: { start: 2, end: 7, versionNumber: 3 }, cursor: { x: 0, y: 1 } }),
      ctx,
    );
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith(
      "doc1",
      { userId: "u1", name: "Ada" },
      { start: 2, end: 7, versionNumber: 3 },
      { x: 0, y: 1 },
      null,
    );
  });

  it("treats cursor:null as clearing", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ cursor: null }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null, null);
  });

  it.each([
    { x: -0.01, y: 0.5 },
    { x: 1.01, y: 0.5 },
    { x: 0.5, y: -1 },
    { x: 0.5, y: 2 },
    { x: "0.5", y: 0.5 },
    { x: 0.5 },
    { x: Number.NaN, y: 0.5 },
    { x: Number.POSITIVE_INFINITY, y: 0.5 },
    "nonsense",
  ])("rejects malformed cursor %j with 400", async (cursor) => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ cursor }), ctx);
    expect(res.status).toBe(400);
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });
});

describe("scroll validation (P5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.requireUser).mockResolvedValue({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValue(true);
  });

  it("forwards a valid scroll as the 5th heartbeat arg", async () => {
    const res = await POST(req({ scroll: { y: 0.5 } }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null, { y: 0.5 });
  });

  it.each([
    ["y above 1", { y: 1.5 }],
    ["y below 0", { y: -0.1 }],
    ["y NaN", { y: Number.NaN }],
    ["y Infinity", { y: Number.POSITIVE_INFINITY }],
    ["y non-number", { y: "x" }],
    ["missing y", {}],
  ])("rejects %s with 400 and no heartbeat", async (_label, scroll) => {
    const res = await POST(req({ scroll }), ctx);
    expect(res.status).toBe(400);
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });
});
