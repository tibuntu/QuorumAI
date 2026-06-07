import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const enqueueMock = vi.fn(async () => "job-1");
vi.mock("../../lib/outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/outbox")>();
  return { ...actual, enqueue: enqueueMock };
});
vi.mock("../../lib/email", () => ({
  isEmailConfigured: vi.fn(() => true),
  sendMail: vi.fn(async () => {}),
}));
vi.mock("../../lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ name: "Bo", email: "bo@e.com" })) },
    document: { findUnique: vi.fn(async () => ({ title: "Plan A" })) },
  },
}));

describe("email digest → outbox", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); process.env.EMAIL_DEBOUNCE_MS = "50"; });
  afterEach(() => { vi.useRealTimers(); });

  it("coalesces a burst into exactly one email.digest job", async () => {
    const { enqueueEmailEvent } = await import("../../lib/email-digest");
    enqueueEmailEvent("u1", "doc1", "comment", "Al");
    enqueueEmailEvent("u1", "doc1", "comment", "Cy");
    enqueueEmailEvent("u1", "doc1", "review", "Al");
    await vi.advanceTimersByTimeAsync(60);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [type, payload] = enqueueMock.mock.calls[0];
    expect(type).toBe("email.digest");
    expect(payload).toMatchObject({ userId: "u1", documentId: "doc1" });
    expect((payload as { events: unknown[] }).events).toHaveLength(3);
  });

  it("no-op (no enqueue) when email unconfigured", async () => {
    const email = await import("../../lib/email");
    vi.mocked(email.isEmailConfigured).mockReturnValueOnce(false);
    const { enqueueEmailEvent } = await import("../../lib/email-digest");
    enqueueEmailEvent("u2", "doc2", "comment", "Al");
    await vi.advanceTimersByTimeAsync(60);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("handler renders and sends one mail for the coalesced job", async () => {
    vi.useRealTimers();
    const email = await import("../../lib/email");
    const { registerEmailDigestHandler } = await import("../../lib/email-digest");
    const { __resetHandlers } = await import("../../lib/outbox");
    __resetHandlers();
    registerEmailDigestHandler();
    const handlers = (globalThis as unknown as { outboxHandlers: Map<string, (p: unknown) => Promise<void>> }).outboxHandlers;
    await handlers.get("email.digest")!({ userId: "u1", documentId: "doc1", events: [{ type: "comment", actorName: "Al" }] });
    expect(email.sendMail).toHaveBeenCalledTimes(1);
  });
});
